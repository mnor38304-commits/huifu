import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import db, { getDb, saveDatabase } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse, Card } from '../types';
import { sendEmail, cardOpenedTemplate, topupSuccessTemplate } from '../mail';
import { UqPaySDK } from '../channels/uqpay';
import { getMerchantOpenableBins } from '../merchant-bin-access';
import {
  validateTopup,
  checkPendingOrder,
  createRechargeOrder,
  callUqPayRecharge,
  markRechargeSuccess,
  markRechargeFailed,
  checkRechargeLimits,
  recordRechargeFailure,
  clearRechargeFailure,
} from '../services/uqpay-recharge';

const router = Router();

// ── GEO 并发锁 ───────────────────────────────────────────────────────────────
// 进程内锁，防止同一用户并发 GEO 开卡
const geoCreateLocks = new Map<number, boolean>();

// ── 渠道 SDK 工厂 ────────────────────────────────────────────────────────────

interface ChannelSDK {
  type: 'uqpay' | 'geo' | 'dogpay' | 'mock';
  sdk?: UqPaySDK | any;
  channel?: any;
}

/**
 * 获取当前启用的发卡渠道 SDK
 * 优先级: UQPay → GEO → DogPay → Mock
 */
async function getChannelSDK(): Promise<ChannelSDK> {
  // 1. UQPay 渠道
  const uqpayChannel = db.prepare(
    "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'UQPAY' AND status = 1"
  ).get() as any;

  if (uqpayChannel) {
    let config: Record<string, string> = {};
    try {
      config = JSON.parse(uqpayChannel.config_json || '{}');
    } catch (_) {}

    const sdk = new UqPaySDK({
      clientId: config.clientId || uqpayChannel.api_key || '',
      apiKey: config.apiSecret || uqpayChannel.api_secret || '',
      baseUrl: uqpayChannel.api_base_url || undefined,
    });

    if (config.depositAddresses) {
      (sdk as any)._platformDepositAddresses = config.depositAddresses;
    }

    console.log('[Channel] 使用 UQPay 渠道');
    return { type: 'uqpay', sdk, channel: uqpayChannel };
  }

  // 2. GEO 渠道（InfiniaX）
  const geoChannel = db.prepare(
    "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'GEO' AND status = 1"
  ).get() as any;

  if (geoChannel) {
    let geoConfig: Record<string, any> = {};
    try { geoConfig = JSON.parse(geoChannel.config_json || '{}'); } catch (_) {}

    if (!geoConfig.userNo) {
      throw new Error('GEO RSA 配置不完整：缺少 userNo');
    }
    if (!geoConfig.privateKey) {
      throw new Error('GEO RSA 配置不完整：缺少 privateKey');
    }
    const geoPublicKey = geoConfig.geoPublicKey || geoConfig.publicKey;
    if (!geoPublicKey) {
      throw new Error('GEO RSA 配置不完整：缺少 geoPublicKey');
    }

    const baseUrl = geoChannel.api_base_url || geoConfig.apiBaseUrl;
    if (!baseUrl) {
      throw new Error('GEO 渠道 api_base_url 未配置');
    }

    try {
      const { GeoSdk } = await import('../channels/geo');
      const sdk = new GeoSdk({
        baseUrl,
        userNo: geoConfig.userNo,
        privateKey: geoConfig.privateKey,
        geoPublicKey,
        customerPublicKey: geoConfig.customerPublicKey || '',
      });
      console.log('[Channel] 使用 GEO 渠道 (RSA 4 参数, privateEncrypt + geoPublicKey decrypt)');
      return { type: 'geo', sdk, channel: geoChannel };
    } catch (err: any) {
      console.error('[Channel] GEO SDK 加载失败:', err.message);
    }
  }

  // 3. DogPay 渠道（兼容旧接口）
  const dogpayChannel = db.prepare(
    "SELECT * FROM card_channels WHERE LOWER(channel_code) = 'dogpay' AND status = 1"
  ).get() as any;

  if (dogpayChannel) {
    try {
      const { DogPaySDK } = await import('../channels/dogpay');
      const sdk = new DogPaySDK({
        appId: dogpayChannel.api_key,
        appSecret: dogpayChannel.api_secret,
        apiBaseUrl: dogpayChannel.api_base_url,
      });
      console.log('[Channel] 使用 DogPay 渠道');
      return { type: 'dogpay', sdk, channel: dogpayChannel };
    } catch (err: any) {
      console.error('[Channel] DogPay SDK 加载失败:', err.message);
    }
  }

  // 3. 无渠道，降级为 Mock
  console.log('[Channel] 无可用渠道，降级为 Mock 模式');
  return { type: 'mock' };
}

// ── 辅助函数 ────────────────────────────────────────────────────────────────

function generateCardNo(binCode?: string): { cardNo: string; masked: string } {
  const bin = String(binCode || '411111').slice(0, 6).padEnd(6, '1');
  const middle = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  const last2 = String(Math.floor(Math.random() * 100)).padStart(2, '0');
  const cardNo = `${bin}${middle}${last2}`;
  return { cardNo, masked: `****${cardNo.slice(-4)}` };
}

function generateCVV(): string {
  return String(Math.floor(100 + Math.random() * 900));
}

function generateExpireDate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 3);
  return `${String(date.getFullYear()).slice(-2)}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// ── 可用卡段 ────────────────────────────────────────────────────────────────

/**
 * 懒冻结：检查并自动冻结已到使用期限的卡片
 */
function freezeExpiredCardsForUser(userId: number) {
  const expired = db.prepare(`
    SELECT id FROM cards WHERE user_id = ? AND status = 1
      AND usage_expires_at IS NOT NULL
      AND usage_expires_at <= datetime('now')
  `).all(userId) as any[];
  if (expired.length === 0) return;
  db.prepare(`
    UPDATE cards SET status = 2,
      auto_frozen_at = datetime('now'),
      auto_frozen_reason = 'USAGE_EXPIRED'
    WHERE user_id = ? AND status = 1
      AND usage_expires_at IS NOT NULL
      AND usage_expires_at <= datetime('now')
  `).run(userId);
  saveDatabase();
}

router.get('/bins/available', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const channel = await getChannelSDK();
    let bins = getMerchantOpenableBins(req.user!.userId);

    if (channel.type !== 'mock') {
      // 渠道模式: 只显示已分配 external_bin_id 的卡段
      bins = bins.filter((bin: any) => !!bin.external_bin_id);
    }

    return res.json({ code: 0, message: 'success', data: bins, timestamp: Date.now() });
  } catch (err: any) {
    console.error('Available bins error:', err.message);
    return res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

// ── 我的卡片列表 ────────────────────────────────────────────────────────────

router.get('/', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  freezeExpiredCardsForUser(req.user!.userId);
  const { status } = req.query;

  let sql = `SELECT id, card_no_masked, card_name, card_type, currency, balance,
    credit_limit, single_limit, daily_limit, status, expire_date, purpose,
    created_at, bin_id, channel_code, remark,
    usage_expires_at, auto_frozen_at, auto_frozen_reason
    FROM cards WHERE user_id = ?`;
  const params: any[] = [req.user!.userId];

  if (status) {
    sql += ' AND status = ?';
    params.push(Number(status));
  }

  sql += ' ORDER BY created_at DESC';

  const cards = db.prepare(sql).all(...params);

  res.json({ code: 0, message: 'success', data: cards, timestamp: Date.now() });
});

// ── 创建卡片 ────────────────────────────────────────────────────────────────

router.post('/', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { cardName, cardType, creditLimit, singleLimit, dailyLimit, purpose, binId } = req.body;

  if (!cardName || !cardType || !creditLimit) {
    return res.json({ code: 400, message: '请填写完整信息', timestamp: Date.now() });
  }

  if (creditLimit < 10 || creditLimit > 10000) {
    return res.json({ code: 400, message: '额度范围: $10 - $10,000', timestamp: Date.now() });
  }

  let cardNo = '';
  let masked = '';
  let cvv = '';
  let expireDate = '';
  let externalId = '';
  let selectedBinId: number | null = null;
  let channelCode = 'MOCK';
  let uqpayCardholderId: string | null = null;
  let uqpayCardResult: any = null; // UQPay 开卡结果（用于后续 card_order_id 等字段）
  let effectiveInitialBalance = 0; // UQPay card_available_balance 初始值（默认 0）

  const channel = await getChannelSDK();
  let allowedBins = getMerchantOpenableBins(req.user!.userId);

  if (channel.type !== 'mock') {
    allowedBins = allowedBins.filter((bin: any) => !!bin.external_bin_id);
    channelCode = channel.type === 'uqpay' ? 'UQPAY' : channel.type === 'geo' ? 'GEO' : 'DOGPAY';
  }

  const selectedBin = binId
    ? allowedBins.find((bin: any) => Number(bin.id) === Number(binId))
    : allowedBins[0];

  if (allowedBins.length === 0) {
    return res.json({ code: 400, message: '当前商户未配置可开通卡段，请联系管理员', timestamp: Date.now() });
  }

  if (!selectedBin) {
    return res.json({ code: 400, message: '所选卡段未开通或不可用', timestamp: Date.now() });
  }

  selectedBinId = Number(selectedBin.id);

  // ── 渠道开卡 ──────────────────────────────────────────────────────────

  if (channel.type === 'uqpay' && channel.sdk) {
    const sdk = channel.sdk;

    try {
      // 获取用户信息
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as any;
      if (!user) {
        return res.json({ code: 401, message: '用户不存在', timestamp: Date.now() });
      }

      // 1. 获取或创建持卡人（含本地缓存）
      const firstName = (user.nickname || user.email || 'User').split(/[@.\s]/)[0] || 'User';
      const lastName = (user.email || 'User').split(/[@]/)[0] || 'User';

      const cardholder = await sdk.getOrCreateCardholder({
        userId: req.user!.userId,
        email: user.email,
        firstName,
        lastName,
        countryCode: 'US',
        phoneNumber: user.phone || '+10000000000',
        nationality: user.country_code || 'US',
        database: getDb(),
      });

      // 持久化本地缓存到磁盘
      saveDatabase();

      uqpayCardholderId = cardholder.id;

      // 2. 获取卡产品（返回标准化 UqPayCardProduct）
      const cardProduct = await sdk.getCardProductId('USD');

      // 3. 创建卡片
      const cardResult = await sdk.createCard({
        cardholderId: cardholder.id,
        cardProductId: cardProduct.product_id,
        cardCurrency: 'USD',
        cardLimit: Number(creditLimit),
        cardType: cardType === 'physical' ? 'physical' : 'virtual',
        metadata: {
          userId: String(req.user!.userId),
          cardName,
        },
      });

      externalId = cardResult.card_id;
      masked = cardResult.last4 ? `****${cardResult.last4}` : `****${cardResult.card_id.slice(-4)}`;
          // UQPay 真实卡号通过 Secure iFrame 展示（PCI DSS 合规），不在 API 直接返回
      // 前端通过 POST /api/v1/cards/{id}/pan-token 获取 iframeUrl
      cardNo = '';
      cvv = '[查看卡号 → Secure iFrame]';
      expireDate = cardResult.expiryYear && cardResult.expiryMonth
        ? `${cardResult.expiryYear}/${cardResult.expiryMonth}`
        : generateExpireDate();

      console.log('[UQPay] 开卡成功:', externalId, masked);

      // 保存开卡结果供后续写入 card_order_id
      uqpayCardResult = cardResult;

      // 尝试获取初始卡余额
      let initialCardBalance: number | null = null;
      if (cardResult.rawJson?.card_available_balance != null) {
        initialCardBalance = Number(cardResult.rawJson.card_available_balance);
        console.log('[UQPay] 开卡响应含 card_available_balance:', initialCardBalance);
      }
      if (initialCardBalance == null) {
        try {
          console.log('[UQPay] 开卡响应无余额，只读查询 getCard...');
          const cardDetail = await sdk.getCard(cardResult.card_id);
          if (cardDetail.card_available_balance != null) {
            initialCardBalance = Number(cardDetail.card_available_balance);
            console.log('[UQPay] getCard 返回 card_available_balance:', initialCardBalance);
          }
        } catch (getErr: any) {
          console.warn('[UQPay] getCard 查询余额失败（只读，不影响开卡）:', getErr.message);
        }
      }
      effectiveInitialBalance = initialCardBalance ?? 0;
      console.log('[UQPay] 初始 cards.balance 将写入:', effectiveInitialBalance);

    } catch (err: any) {
      console.error('[UQPay] 开卡失败:', err.message);
      return res.json({
        code: 500,
        message: 'UQPay 开卡失败: ' + err.message,
        timestamp: Date.now()
      });
    }

  } else if (channel.type === 'dogpay' && (channel.sdk as any)?.createCard) {
    // DogPay 兼容
    try {
      const dogpayRes = await (channel.sdk as any).createCard({
        cardType: cardType === 'physical' ? 'physical' : 'virtual',
        cardName,
        channelId: selectedBin.external_bin_id,
      });

      if (dogpayRes && dogpayRes.data) {
        const cardData = dogpayRes.data;
        externalId = cardData.id;
        cardNo = cardData.idNo || '';
        masked = cardData.last4 ? `****${cardData.last4}` : '****';
        expireDate = cardData.createdAt
          ? new Date(cardData.createdAt).toISOString().split('T')[0]
          : generateExpireDate();

        cvv = cardData.cvv && cardData.cvv !== '***'
          ? cardData.cvv
          : '[查看卡号 → Secure iFrame]';
      } else {
        return res.json({
          code: 500,
          message: '渠道开卡失败: ' + (dogpayRes?.message || '未知错误'),
          timestamp: Date.now()
        });
      }
    } catch (err: any) {
      console.error('DogPay create card error:', err.message);
      return res.json({ code: 500, message: '渠道接口调用异常', timestamp: Date.now() });
    }

  } else if (channel.type === 'geo' && (channel.sdk as any)?.createCard) {
    // ── GEO 开卡（灰度保护）────────────────────────────────────────────
    let geoConfig: Record<string, any> = {};
    try { geoConfig = JSON.parse(channel.channel?.config_json || '{}'); } catch (_) {}

    // 安全默认值
    const isReadonly = geoConfig.readonly !== false;
    const isCreateCardEnabled = geoConfig.enableCreateCard === true;
    const isCanaryEnabled = geoConfig.createCardCanaryEnabled === true;
    const testUserIds: number[] = geoConfig.createCardTestUserIds || [];
    const allowedBins: string[] = geoConfig.allowedBinIds || [];
    const maxLimit: number = (typeof geoConfig.maxCardLimit === 'number' && geoConfig.maxCardLimit > 0) ? geoConfig.maxCardLimit : 5;
    const dailyLimit: number = (typeof geoConfig.dailyCreateLimit === 'number' && geoConfig.dailyCreateLimit > 0) ? geoConfig.dailyCreateLimit : 1;
    const reqLimit = Number(creditLimit);
    const userId = req.user!.userId;

    // ════ 17 项顺序校验 ════

    // 1. readonly
    if (isReadonly) {
      return res.json({ code: 503, message: 'GEO 渠道当前为只读模式，无法开卡', timestamp: Date.now() });
    }
    // 2. enableCreateCard
    if (!isCreateCardEnabled) {
      return res.json({ code: 503, message: 'GEO 开卡未启用', timestamp: Date.now() });
    }
    // 3. createCardCanaryEnabled
    if (!isCanaryEnabled) {
      return res.json({ code: 503, message: 'GEO 开卡灰度尚未开启', timestamp: Date.now() });
    }
    // 4. createCardTestUserIds 为空
    if (testUserIds.length === 0) {
      return res.json({ code: 503, message: 'GEO 开卡白名单未配置', timestamp: Date.now() });
    }
    // 5. 当前用户不在白名单
    if (!testUserIds.includes(userId)) {
      return res.json({ code: 403, message: '您不在 GEO 开卡灰度白名单中', timestamp: Date.now() });
    }
    // 6. allowedBinIds 为空
    if (allowedBins.length === 0) {
      return res.json({ code: 503, message: 'GEO 开卡 BIN 白名单未配置', timestamp: Date.now() });
    }
    // 7. BIN 不在白名单
    if (!selectedBin.external_bin_id || !allowedBins.includes(selectedBin.external_bin_id)) {
      return res.json({ code: 403, message: '所选 BIN 不在 GEO 开卡白名单中', timestamp: Date.now() });
    }
    // 8. channel_code 非 GEO
    if (selectedBin.channel_code !== 'GEO') {
      return res.json({ code: 400, message: '所选 BIN 不属于 GEO 渠道', timestamp: Date.now() });
    }
    // 9. 非 SINGLE 模式
    if (selectedBin.mode_type && selectedBin.mode_type !== 'SINGLE') {
      return res.json({ code: 400, message: 'GEO 仅支持 SINGLE 独立额度卡', timestamp: Date.now() });
    }
    // 10. external_bin_id 为空（二次确认）
    if (!selectedBin.external_bin_id) {
      return res.json({ code: 400, message: '所选 BIN 无 external_bin_id', timestamp: Date.now() });
    }
    // 11. cardLimit 非数字
    if (isNaN(reqLimit)) {
      return res.json({ code: 400, message: '额度必须为数字', timestamp: Date.now() });
    }
    // 12. cardLimit <= 0
    if (reqLimit <= 0) {
      return res.json({ code: 400, message: '额度必须大于 0', timestamp: Date.now() });
    }
    // 13. maxCardLimit <= 0
    if (maxLimit <= 0) {
      return res.json({ code: 503, message: 'GEO 开卡额度上限配置异常', timestamp: Date.now() });
    }
    // 14. cardLimit > maxCardLimit
    if (reqLimit > maxLimit) {
      return res.json({ code: 400, message: `GEO 开卡额度不能超过 $${maxLimit}`, timestamp: Date.now() });
    }

    // 15. 每日创建限制
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayCount = db.prepare(
      "SELECT COUNT(*) as c FROM cards WHERE channel_code='GEO' AND user_id=? AND date(created_at)=?"
    ).get(userId, todayStr) as any;
    if (todayCount && todayCount.c >= dailyLimit) {
      return res.json({ code: 429, message: `今日 GEO 开卡已达上限（${dailyLimit}张）`, timestamp: Date.now() });
    }

    // 16. 并发锁
    if (geoCreateLocks.get(userId)) {
      return res.json({ code: 429, message: '您有 GEO 开卡请求正在处理中，请稍后重试', timestamp: Date.now() });
    }
    geoCreateLocks.set(userId, true);

    // ── 获取 GEO cardUserId ──
    // 从 config_json.geoCardUserIds 映射表读取
    const geoCardUserIdMap = geoConfig.geoCardUserIds || {};
    const geoCardUserId = geoCardUserIdMap[String(userId)] || '';

    // cardUserId 为空则直接拒绝，不调用 GEO API
    if (!geoCardUserId || !String(geoCardUserId).trim()) {
      geoCreateLocks.delete(userId);
      return res.json({ code: 400, message: 'GEO 持卡人未创建，请先创建 GEO 持卡人', timestamp: Date.now() });
    }

    // 17. 一个 cardUserId 最多 5 张卡
    const geoCardCount = db.prepare(
      "SELECT COUNT(*) as c FROM cards WHERE user_id=? AND channel_code='GEO' AND status IN (0,1,2)"
    ).get(userId) as any;
    if (geoCardCount && geoCardCount.c >= 5) {
      geoCreateLocks.delete(userId);
      return res.json({ code: 429, message: '每个 GEO 持卡人最多开通 5 张卡（当前已满）', timestamp: Date.now() });
    }

    try {
      const sdk = channel.sdk as any;
      const geoCard = await sdk.createCard({
        userId,
        cardName,
        cardLimit: reqLimit,
        currency: geoConfig.defaultCurrency || 'USD',
        binRangeId: selectedBin.external_bin_id,
        validityYears: geoConfig.defaultCardValidityYears || 2,
        cardUserId: geoCardUserId,
      });

      // ── 安全落库 ──
      externalId = geoCard.cardId || '';
      // cardNo 只取 last4 脱敏
      const geoLast4 = geoCard.cardNo ? geoCard.cardNo.slice(-4) : '';
      masked = geoLast4 ? `****${geoLast4}` : `****${externalId.slice(-4)}`;
      cardNo = '';             // 完整 cardNo 不落库
      cvv = '';             // cardVerifyNo/CVV 不落库
      expireDate = geoCard.cardExpiryDate
        ? geoCard.cardExpiryDate.slice(0, 7)
        : generateExpireDate();
      effectiveInitialBalance = 0;

      console.log('[GEO] 开卡成功:', externalId, masked, 'expire:', expireDate);
    } catch (err: any) {
      console.error('[GEO] 开卡失败:', err.message);
      return res.json({
        code: 500,
        message: 'GEO 开卡失败: ' + err.message,
        timestamp: Date.now()
      });
    } finally {
      // 不论成功失败都释放并发锁
      geoCreateLocks.delete(userId);
    }

  } else {
    // Mock 模式
    const mock = generateCardNo(selectedBin.bin_code || undefined);
    cardNo = mock.cardNo;
    masked = mock.masked;
    cvv = generateCVV();
    expireDate = generateExpireDate();
  }

  // ── 写入数据库 ─────────────────────────────────────────────────────────

  // UQPay PENDING/PROCESSING → status=0(待激活)，其他默认 1(正常)
  const insertStatus = (channel.type === 'uqpay' && uqpayCardResult?.card_status &&
    ['PENDING', 'PROCESSING'].includes(uqpayCardResult.card_status.toUpperCase())) ? 0 : 1;

  // 新卡默认使用期限：1个月
  const defaultUsageExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);

  const result = db.prepare(`
    INSERT INTO cards (card_no, card_no_masked, user_id, bin_id, card_name, card_type,
      currency, balance, credit_limit, single_limit, daily_limit, status, expire_date,
      cvv, purpose, external_id, channel_code, uqpay_cardholder_id, card_order_id,
      usage_expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cardNo,
    masked,
    req.user!.userId,
    selectedBinId,
    cardName,
    cardType,
    effectiveInitialBalance,
    creditLimit,
    singleLimit || null,
    dailyLimit || null,
    insertStatus,
    expireDate,
    cvv,
    purpose || null,
    externalId || null,
    channelCode,
    uqpayCardholderId,
    uqpayCardResult?.card_order_id || null,
    defaultUsageExpiresAt
  );

  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user!.userId) as any;

  if (user?.email) {
    sendEmail({
      to: user.email,
      subject: '💳 开卡成功 - VCC虚拟卡系统',
      html: cardOpenedTemplate(masked, cardName, creditLimit)
    });
  }

  res.json({
    code: 0,
    message: insertStatus === 0 ? '开卡请求已提交，等待激活' : '开卡成功',
    data: {
      id: result.lastInsertRowid,
      cardNoMasked: masked,
      cvv,
      expireDate,
      cardName,
      cardType,
      creditLimit,
      binId: selectedBinId,
      channel: channelCode,
      status: insertStatus,
      // UQPay 真实卡号/CVV 需通过 Secure iFrame 查看
      requiresSecureIframe: channelCode === 'UQPAY',
      // 前端调用 GET /pan-token 获取 iframe URL
      secureIframeHint: channelCode === 'UQPAY'
        ? '卡片已创建。请调用 GET /pan-token 获取 Secure iFrame URL 查看完整卡号'
        : undefined,
      // UQPay 卡片状态信息
      ...(channelCode === 'UQPAY' && uqpayCardResult ? {
        externalCardStatus: uqpayCardResult.card_status,
        externalOrderStatus: uqpayCardResult.order_status,
      } : {}),
    },
    timestamp: Date.now()
  });
});

// ── 卡片详情 ────────────────────────────────────────────────────────────────

router.get('/:id', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  freezeExpiredCardsForUser(req.user!.userId);
  const card = db.prepare(`
    SELECT id, card_no_masked, card_name, card_type, currency, balance,
      credit_limit, single_limit, daily_limit, status, expire_date, purpose,
      created_at, channel_code, external_id, remark,
      usage_expires_at, auto_frozen_at, auto_frozen_reason
    FROM cards WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user!.userId);

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  res.json({ code: 0, message: 'success', data: card, timestamp: Date.now() });
});

// ── 卡片详情（增强版，含累计消费/累计转入） ─────────────────────────────────

router.get('/:id/detail', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  freezeExpiredCardsForUser(req.user!.userId);
  const card = db.prepare(`
    SELECT c.*, b.country as bin_country
    FROM cards c
    LEFT JOIN card_bins b ON c.bin_id = b.id
    WHERE c.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user!.userId) as any;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  // 🔒 安全响应头：敏感信息不缓存
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');

  // 累计消费：成功消费/授权交易
  const spendRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions WHERE card_id = ? AND user_id = ? AND status = 1
    AND txn_type IN ('CONSUME', 'AUTH', 'CAPTURE', 'PURCHASE', 'WITHDRAWAL')
  `).get(req.params.id, req.user!.userId) as any;
  const totalSpend = spendRow?.total || 0;

  // 累计转入：成功充值/转入交易
  const topupRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions WHERE card_id = ? AND user_id = ? AND status = 1
    AND txn_type IN ('TOPUP', 'TRANSFER_IN', 'REFUND')
  `).get(req.params.id, req.user!.userId) as any;
  const totalTopup = topupRow?.total || 0;

  const statusMap: Record<number, string> = {
    0: '待激活', 1: '可用', 2: '冻结', 3: '已过期', 4: '已注销',
  };

  const issuedAt = card.created_at
    ? new Date(card.created_at).toISOString().replace('T', ' ').slice(0, 19)
    : '';

  res.json({
    code: 0,
    message: 'success',
    data: {
      id: card.id,
      cardId: card.external_id || '',
      remark: card.remark || card.card_name || 'VCC 卡片',
      status: card.status,
      statusText: statusMap[card.status] || '未知',
      cardNumberMasked: card.card_no_masked,
      expiryMasked: card.expire_date ? (card.expire_date.includes('/') ? card.expire_date : '**/**') : '**/**',
      cvvMasked: '***',
      balance: card.balance || 0,
      totalSpendAmount: totalSpend,
      totalTopupAmount: totalTopup,
      currency: card.currency || 'USD',
      createdAt: issuedAt,
      issueCountry: card.bin_country || 'US',
      billingAddress: card.purpose || '',
    },
    timestamp: Date.now(),
  });
});

// ── 交易明细 ───────────────────────────────────────────────────────────

router.get('/:id/transactions', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  // 验证卡片归属
  const card = db.prepare('SELECT id FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId);
  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  const { page = 1, pageSize = 20, startDate, endDate, type, status, keyword } = req.query;

  let sql = 'SELECT * FROM transactions WHERE card_id = ? AND user_id = ?';
  const params: any[] = [req.params.id, req.user!.userId];

  if (startDate) { sql += ' AND txn_time >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND txn_time <= ?'; params.push(endDate + ' 23:59:59'); }
  if (type) { sql += ' AND txn_type = ?'; params.push(type); }
  if (status !== undefined && status !== '') { sql += ' AND status = ?'; params.push(Number(status)); }
  if (keyword) { sql += ' AND txn_no LIKE ?'; params.push(`%${keyword}%`); }

  const totalSql = sql.replace('SELECT *', 'SELECT COUNT(*) as c');
  const total = ((db.prepare(totalSql).get(...params)) as any)?.c || 0;

  const offset = (Number(page) - 1) * Number(pageSize);
  const list = db.prepare(sql + ' ORDER BY txn_time DESC LIMIT ? OFFSET ?').all(...params, Number(pageSize), offset);

  const typeMap: Record<string, string> = {
    TOPUP: '充值', CONSUME: '消费', AUTH: '授权', CAPTURE: '捕获',
    REFUND: '退款', CANCEL_REFUND: '退款', TRANSFER_IN: '转入',
    WITHDRAWAL: '提现', FEE: '手续费', VOID: '撤销',
  };
  const statusMap: Record<number, string> = {
    0: '处理中', 1: '成功', 2: '失败', 3: '撤销',
  };

  const mapped = list.map((r: any) => ({
    id: r.id,
    transactionDate: new Date(r.txn_time).toISOString().replace('T', ' ').slice(0, 19),
    transactionType: typeMap[r.txn_type] || r.txn_type,
    amount: Number(r.amount).toFixed(2),
    currency: r.currency || 'USD',
    status: r.status,
    statusText: statusMap[r.status] || '未知',
    transactionNo: r.txn_no,
    merchantName: r.merchant_name || '',
    remark: '',
  }));

  res.json({
    code: 0,
    message: 'success',
    data: { list: mapped, total, page: Number(page), pageSize: Number(pageSize) },
    timestamp: Date.now(),
  });
});

// ── 操作记录 ───────────────────────────────────────────────────────────

router.get('/:id/operations', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  // 验证卡片归属
  const card = db.prepare('SELECT id, created_at FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId) as any;
  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  const { page = 1, pageSize = 20 } = req.query;
  const records: any[] = [];

  // 1. 开卡记录
  records.push({
    createdAt: new Date(card.created_at).toISOString().replace('T', ' ').slice(0, 19),
    operationType: '开卡',
    operator: '当前用户',
    result: '成功',
    remark: '',
  });

  // 2. 交易记录中的操作
  const txnOps = db.prepare(
    `SELECT txn_time, txn_type, amount, status, txn_no FROM transactions
     WHERE card_id = ? AND user_id = ? ORDER BY txn_time DESC`
  ).all(req.params.id, req.user!.userId) as any[];

  const txnTypeLabel: Record<string, string> = {
    TOPUP: '充值', CONSUME: '消费', AUTH: '授权', REFUND: '退款',
    CANCEL_REFUND: '退款', TRANSFER_IN: '转入', FEE: '手续费',
  };
  const txnStatusLabel: Record<number, string> = {
    0: '处理中', 1: '成功', 2: '失败', 3: '撤销',
  };

  for (const t of txnOps) {
    records.push({
      createdAt: new Date(t.txn_time).toISOString().replace('T', ' ').slice(0, 19),
      operationType: txnTypeLabel[t.txn_type] || t.txn_type,
      operator: '系统',
      result: txnStatusLabel[t.status] || '未知',
      remark: t.txn_no ? `流水号: ${t.txn_no}` : '',
    });
  }

  // 3. UQPay 充值记录
  const uqpayOrders = db.prepare(
    `SELECT created_at, amount, status, error_message FROM uqpay_recharge_orders
     WHERE card_id = ? ORDER BY created_at DESC`
  ).all(req.params.id) as any[];

  for (const o of uqpayOrders) {
    records.push({
      createdAt: new Date(o.created_at).toISOString().replace('T', ' ').slice(0, 19),
      operationType: '渠道充值',
      operator: '系统',
      result: o.status === 'SUCCESS' ? '成功' : o.status === 'FAILED' ? '失败' : o.status === 'PENDING' ? '处理中' : o.status,
      remark: o.error_message || '',
    });
  }

  // 排序：按时间倒序
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = records.length;
  const offset = (Number(page) - 1) * Number(pageSize);
  const paged = records.slice(offset, offset + Number(pageSize));

  res.json({
    code: 0,
    message: 'success',
    data: { list: paged, total },
    timestamp: Date.now(),
  });
});

// ── 查看完整卡面信息 ────────────────────────────────────────────────────────
// Secure iFrame 模式: https://docs.uqpay.com/docs/secure-iframe-guide
//
// 流程: POST /pan-token → 获得 iframeUrl → 前端嵌入 iFrame → 用户在 iFrame 内查看卡号/CVV/有效期
// Token 有效期 60 秒，仅可使用一次

/**
 * GET /:id/pan-token
 * 为 UQPay 卡片生成 Secure iFrame PAN Token，返回可直接使用的 iFrame URL
 * 返回: { iframeUrl, cardId, expiresIn, expiresAt }
 */
router.get('/:id/pan-token', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare(
    'SELECT id, external_id, channel_code FROM cards WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId) as any;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.channel_code !== 'UQPAY' || !card.external_id) {
    return res.json({ code: 400, message: '该渠道不支持 Secure iFrame', timestamp: Date.now() });
  }

  // 🔒 安全头：禁止缓存 iframeUrl / token
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');

  try {
    const channel = await getChannelSDK();
    if (channel.type !== 'uqpay' || !channel.sdk) {
      return res.json({ code: 500, message: 'UQPay 渠道未配置', timestamp: Date.now() });
    }

    // 校验 external_id 是否有效（不能是本地 id 或 masked card_no）
    const extId = String(card.external_id || '');
    if (extId.length < 8 || extId.includes('*')) {
      return res.json({ code: 400, message: '该卡缺少有效的渠道卡ID，无法查看完整卡信息，请联系管理员同步卡信息', timestamp: Date.now() });
    }

    const { token, expiresIn, expiresAt } = await channel.sdk.getPanToken(extId);
    const iframeUrl = channel.sdk.buildSecureIframeUrl(token, extId, 'zh');

    res.json({
      code: 0,
      message: 'success',
      data: {
        iframeUrl,
        cardId: extId,
        expiresIn,    // 秒，60
        expiresAt,    // ISO 8601，过期时间
      },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    const extId = String(card?.external_id || '').slice(-4);
    console.error("[UQPay] PAN Token 生成失败: localCardId=" + req.params.id + " extLast4=" + extId);
    const msg = err.message || '';

    // UQPay 返回 card_not_found → 卡在发卡渠道已不存在或停用
    if (msg.includes('card_not_found') || msg.includes('deactivated')) {
      return res.json({ code: 400, message: '该卡在发卡渠道不存在或已停用，无法查看完整卡信息', timestamp: Date.now() });
    }
    return res.json({ code: 500, message: 'PAN Token 生成失败: ' + msg, timestamp: Date.now() });
  }
});

/**
 * GET /:id/reveal
 * 查看完整卡面信息
 * - Mock/DogPay: 返回数据库中的明文数据
 * - UQPay: 返回 Secure iFrame 模式，告知前端需通过 /pan-token 获取 iFrame URL
 */
router.get('/:id/reveal', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare(
    'SELECT card_no, cvv, expire_date, external_id, channel_code FROM cards WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId) as (Card & { external_id?: string; channel_code?: string }) | undefined;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  // 🔒 安全响应头：禁止缓存完整卡面信息
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');

  // UQPay 渠道 → Secure iFrame 模式，不返回明文卡号
  if (card.channel_code === 'UQPAY' && card.external_id) {
    return res.json({
      code: 0,
      message: 'success',
      data: {
        // 明文卡号/CVV 需通过 Secure iFrame 获取，不在 API 直接返回
        cardNo: null,
        cvv: null,
        expireDate: card.expire_date,
        mode: 'secure_iframe',   // 告诉前端使用 Secure iFrame
        hint: '请调用 /pan-token 接口获取 Secure iFrame URL，在嵌入页面中查看完整卡号',
      },
      timestamp: Date.now(),
    });
  }

  // Mock / DogPay → 直接返回数据库中的数据
  const isDogPay = card.channel_code === 'DOGPAY';
  const cvvDisplay = isDogPay
    ? (card.cvv?.startsWith('[') ? card.cvv : `请在 DogPay 控制台查看完整卡面信息`)
    : card.cvv;

  res.json({
    code: 0,
    message: 'success',
    data: {
      cardNo: card.card_no || null,
      cvv: cvvDisplay,
      expireDate: card.expire_date,
      mode: 'direct',   // 直接展示模式
    },
    timestamp: Date.now(),
  });
});

// ── 卡片充值 ────────────────────────────────────────────────────────────────

router.post('/:id/topup', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { amount } = req.body;
  const userId = req.user!.userId;

  // 1. 校验充值金额
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0 || !Number.isFinite(numAmount)) {
    return res.json({ code: 400, message: '请输入有效金额', timestamp: Date.now() });
  }

  // 2. 校验卡片
  const card = db.prepare(
    'SELECT c.*, u.email FROM cards c LEFT JOIN users u ON c.user_id = u.id WHERE c.id = ? AND c.user_id = ?'
  ).get(req.params.id, userId) as (Card & { email?: string; channel_code?: string; external_id?: string }) | undefined;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.status !== 1) {
    return res.json({ code: 400, message: '卡片状态异常', timestamp: Date.now() });
  }

  // 3. UQPay 卡走真实充值流程
  if (card.channel_code && card.channel_code.toUpperCase() === 'UQPAY') {
    // -- double guard: env var switch + user allowlist --
    const enableUqpayRealRecharge = process.env.ENABLE_UQPAY_REAL_RECHARGE;
    if (enableUqpayRealRecharge !== 'true') {
      return res.json({ code: 400, message: 'UQPay 真实充值暂未开放', timestamp: Date.now() });
    }
    const testUserIds = (process.env.UQPAY_RECHARGE_TEST_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    // 空列表 = 全量开放；非空时才检查白名单
    if (testUserIds.length > 0 && !testUserIds.includes(String(userId))) {
      return res.json({ code: 403, message: 'UQPay 真实充值仅限测试用户', timestamp: Date.now() });
    }
    // 白名单用户跳过所有限额校验（单笔、日累计、并发、失败冻结）
    const skipLimits = testUserIds.length > 0 && testUserIds.includes(String(userId));
    // -----------------------------------------------------------------
    try {
      // 3a. 校验
      const validation = validateTopup(card.id, userId, numAmount);

      // 3b. 幂等/并发检查（同卡 PENDING 保护）
      if (checkPendingOrder(card.id)) {
        return res.json({
          code: 400,
          message: '该卡有充值请求正在处理中，请稍后查询',
          timestamp: Date.now(),
        });
      }

      // 3c. 综合限额校验（金额上下限、日累计、卡累计、用户PENDING并发、失败冻结）
      checkRechargeLimits(userId, card.id, numAmount, skipLimits);

      // 3d. 生成幂等键
      const uniqueRequestId = randomUUID();

      // 3d. 开启事务：扣钱包 + 写订单
      const orderId = createRechargeOrder(
        userId,
        card.id,
        numAmount,
        uniqueRequestId,
        validation.externalId,
        validation.cardNoMasked,
        validation.walletBalance
      );

      console.log(
        `[UQPay Topup] 充值请求已创建: orderId=${orderId}, amount=${numAmount}, cardId=${card.id}`
      );

      // 3e. 获取 SDK
      const uqpayChannel = db.prepare(
        "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'UQPAY' AND status = 1"
      ).get() as any;
      if (!uqpayChannel) {
        throw new Error('UQPay 渠道未配置');
      }

      let config: Record<string, string> = {};
      try { config = JSON.parse(uqpayChannel.config_json || '{}'); } catch (_) {}

      const sdk = new UqPaySDK({
        clientId: config.clientId || uqpayChannel.api_key || '',
        apiKey: config.apiSecret || uqpayChannel.api_secret || '',
        baseUrl: uqpayChannel.api_base_url || undefined,
      });

      // 3f. 调用 UQPay 真实充值
      const result = await callUqPayRecharge(sdk, validation.externalId, numAmount, uniqueRequestId);

      console.log(
        `[UQPay Topup] API 响应: orderId=${orderId}, status=${result.order_status}, card_order_id=${result.card_order_id}`
      );

      // 3g. 根据结果处理
      if (result.order_status === 'SUCCESS') {
        // 充值成功 → 清除连续失败计数
        clearRechargeFailure(userId);
        const newCardBalance = await markRechargeSuccess(orderId, result, card.id);

        // 获取更新后的钱包余额
        const updatedWallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;

        return res.json({
          code: 0,
          message: '充值成功',
          data: {
            orderId,
            orderStatus: 'SUCCESS',
            newCardBalance,
            walletBalance: updatedWallet ? updatedWallet.balance_usd : 0,
          },
          timestamp: Date.now(),
        });
      } else if (result.order_status === 'PENDING') {
        // 异步处理中，钱包已扣，等 webhook 回调
        const updatedWallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;

        return res.json({
          code: 0,
          message: '充值处理中，请稍后查询',
          data: {
            orderId,
            orderStatus: 'PENDING',
            walletBalance: updatedWallet ? updatedWallet.balance_usd : 0,
          },
          timestamp: Date.now(),
        });
      } else {
        // FAILED
        markRechargeFailed(orderId, 'UQPay returned FAILED', userId, card.id, numAmount);
        recordRechargeFailure(userId);

        return res.json({
          code: 400,
          message: '充值失败: UQPay 拒绝了充值请求',
          data: { orderId, orderStatus: 'FAILED' },
          timestamp: Date.now(),
        });
      }
    } catch (err: any) {
      const msg = err?.message || String(err);

      // 网络超时或未知错误 → 标记为 UNKNOWN，不回滚
      if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') ||
          msg.includes('socket hang up') || msg.includes('fetch failed') ||
          msg.includes('network') || msg.includes('timeout')) {
        console.error('[UQPay Topup] 网络错误:', msg);
        return res.json({
          code: 0,
          message: '充值状态待确认，请稍后查询',
          timestamp: Date.now(),
        });
      }

      // 其他错误（如校验失败 code=400）
      if (err.code && err.code >= 400 && err.code < 500) {
        return res.json({ code: err.code, message: err.message, timestamp: Date.now() });
      }

      console.error('[UQPay Topup] 充值异常:', msg);
      return res.json({ code: 500, message: '充值失败: ' + msg, timestamp: Date.now() });
    }
  }

  // 4. 非 UQPay 卡：保持现有本地测试充值逻辑
  // 4a. 校验钱包余额
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;
  if (!wallet) {
    return res.json({ code: 400, message: '钱包不存在，请先创建钱包', timestamp: Date.now() });
  }

  if (wallet.balance_usd < numAmount) {
    return res.json({ code: 400, message: `钱包余额不足，当前余额: $${wallet.balance_usd}`, timestamp: Date.now() });
  }

  // 4b. 使用事务执行：扣减钱包 → 增加卡余额 → 写流水
  const database = getDb();
  try {
    database.run('BEGIN');

    const walletBalanceBefore = wallet.balance_usd;
    const walletBalanceAfter = walletBalanceBefore - numAmount;
    const cardBalanceBefore = card.balance;
    const cardBalanceAfter = cardBalanceBefore + numAmount;

    // 扣减钱包余额
    database.run('UPDATE wallets SET balance_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [walletBalanceAfter, userId]);

    // 增加卡片余额
    database.run('UPDATE cards SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [cardBalanceAfter, card.id]);

    // 写入交易流水
    const txnNo = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
    database.run(`
      INSERT INTO transactions (txn_no, card_id, user_id, txn_type, amount, currency, status, merchant_name, txn_time)
      VALUES (?, ?, ?, 'TOPUP', ?, 'USD', 1, '账户充值', CURRENT_TIMESTAMP)
    `, [txnNo, card.id, userId, numAmount]);

    // 写入钱包流水（含 balance_before 和 balance_after）
    database.run(`
      INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type, reference_id)
      VALUES (?, 'CARD_TOPUP', ?, ?, ?, 'USD', ?, 'card_topup', ?)
    `, [userId, -numAmount, walletBalanceBefore, walletBalanceAfter,
      `充值到卡片 ${card.card_no_masked}`, card.id]);

    database.run('COMMIT');
    saveDatabase();

    // 5. 发送邮件通知
    if (card.email) {
      sendEmail({
        to: card.email,
        subject: '💰 充值成功 - VCC虚拟卡系统',
        html: topupSuccessTemplate(card.card_no_masked, numAmount, cardBalanceAfter)
      });
    }

    res.json({
      code: 0,
      message: '充值成功',
      data: {
        newBalance: cardBalanceAfter,
        walletBalance: walletBalanceAfter,
      },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    database.run('ROLLBACK');
    saveDatabase();
    console.error('[Card Topup] 事务失败:', err.message);
    return res.json({ code: 500, message: '充值失败，请稍后重试', timestamp: Date.now() });
  }
});

// ── 冻结卡片 ────────────────────────────────────────────────────────────────

router.post('/:id/freeze', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId) as any;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.external_id) {
    const channel = await getChannelSDK();

    if (channel.type === 'uqpay' && channel.sdk) {
      try {
        await channel.sdk.freezeCard(card.external_id);
      } catch (err: any) {
        return res.json({ code: 500, message: 'UQPay 冻结失败: ' + err.message, timestamp: Date.now() });
      }
    } else if (channel.type === 'dogpay' && (channel.sdk as any)?.freezeCard) {
      try {
        await (channel.sdk as any).freezeCard(card.external_id);
      } catch (err: any) {
        return res.json({ code: 500, message: '渠道冻结失败: ' + err.message, timestamp: Date.now() });
      }
    }
  }

  db.prepare('UPDATE cards SET status = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ code: 0, message: '卡片已冻结', timestamp: Date.now() });
});

// ── 解冻卡片 ────────────────────────────────────────────────────────────────

router.post('/:id/unfreeze', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId) as any;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.external_id) {
    const channel = await getChannelSDK();

    if (channel.type === 'uqpay' && channel.sdk) {
      try {
        await channel.sdk.unfreezeCard(card.external_id);
      } catch (err: any) {
        return res.json({ code: 500, message: 'UQPay 解冻失败: ' + err.message, timestamp: Date.now() });
      }
    } else if (channel.type === 'dogpay' && (channel.sdk as any)?.unfreezeCard) {
      try {
        await (channel.sdk as any).unfreezeCard(card.external_id);
      } catch (err: any) {
        return res.json({ code: 500, message: '渠道解冻失败: ' + err.message, timestamp: Date.now() });
      }
    }
  }

  db.prepare('UPDATE cards SET status = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ code: 0, message: '卡片已解冻', timestamp: Date.now() });
});

// ── 注销卡片 ────────────────────────────────────────────────────────────────

router.post('/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId) as any;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.external_id) {
    const channel = await getChannelSDK();

    if (channel.type === 'uqpay' && channel.sdk) {
      try {
        await channel.sdk.cancelCard(card.external_id);
      } catch (err: any) {
        return res.json({ code: 500, message: 'UQPay 销卡失败: ' + err.message, timestamp: Date.now() });
      }
    } else if (channel.type === 'dogpay' && (channel.sdk as any)?.deleteCard) {
      try {
        await (channel.sdk as any).deleteCard(card.external_id);
      } catch (err: any) {
        return res.json({ code: 500, message: '渠道销卡失败: ' + err.message, timestamp: Date.now() });
      }
    }
  }

  if (card.balance > 0) {
    const txnNo = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
    db.prepare(`
      INSERT INTO transactions (txn_no, card_id, user_id, txn_type, amount, currency, status, merchant_name, txn_time)
      VALUES (?, ?, ?, 'CANCEL_REFUND', ?, 'USD', 1, '销卡退款', CURRENT_TIMESTAMP)
    `).run(txnNo, card.id, req.user!.userId, card.balance);
  }

  db.prepare('UPDATE cards SET status = 4, balance = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ code: 0, message: '卡片已注销', timestamp: Date.now() });
});

// ── 更新卡片备注 ─────────────────────────────────────────────────────────────

router.patch('/:id/remark', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const { remark } = req.body;
  if (typeof remark !== 'string' || remark.length > 100) {
    return res.json({ code: 400, message: '备注最长 100 字符', timestamp: Date.now() });
  }
  if (/<[^>]*>|javascript:|on\w+=/i.test(remark)) {
    return res.json({ code: 400, message: '备注包含非法内容', timestamp: Date.now() });
  }

  const card = db.prepare('SELECT id FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId);
  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  const trimmed = remark.trim();
  db.prepare('UPDATE cards SET remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(trimmed || null, req.params.id);
  saveDatabase();

  res.json({ code: 0, message: '备注已更新', timestamp: Date.now() });
});

// ── 设置使用到期时间 ─────────────────────────────────────────────────────────

router.patch('/:id/usage-expiry', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const { preset, usageExpiresAt } = req.body;

  const card = db.prepare(
    'SELECT id, status, usage_expires_at, auto_frozen_reason FROM cards WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user!.userId) as any;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.status === 4) {
    return res.json({ code: 400, message: '已注销卡不允许操作', timestamp: Date.now() });
  }

  let newDate: Date;
  const now = new Date();

  if (usageExpiresAt) {
    newDate = new Date(usageExpiresAt);
    if (isNaN(newDate.getTime())) {
      return res.json({ code: 400, message: '时间格式无效', timestamp: Date.now() });
    }
    if (newDate <= now) {
      return res.json({ code: 400, message: '到期时间不能早于当前时间', timestamp: Date.now() });
    }
  } else if (preset) {
    const base = card.usage_expires_at
      ? new Date(card.usage_expires_at.replace(' ', 'T'))
      : now;
    if (isNaN(base.getTime())) {
      // 如果存储的时间无效，回退到当前时间
      base.setTime(now.getTime());
    }
    // 如果 base 已过期，从当前时间开始计算
    const effectiveBase = base > now ? base : now;

    switch (preset) {
      case '1m': newDate = new Date(effectiveBase.getTime() + 30 * 24 * 60 * 60 * 1000); break;
      case '3m': newDate = new Date(effectiveBase.getTime() + 90 * 24 * 60 * 60 * 1000); break;
      case '6m': newDate = new Date(effectiveBase.getTime() + 180 * 24 * 60 * 60 * 1000); break;
      case '1y': newDate = new Date(effectiveBase.getTime() + 365 * 24 * 60 * 60 * 1000); break;
      default:
        return res.json({ code: 400, message: '预设值无效，支持: 1m/3m/6m/1y', timestamp: Date.now() });
    }
  } else {
    return res.json({ code: 400, message: '请提供 preset 或 usageExpiresAt', timestamp: Date.now() });
  }

  const newUsageExpiresAt = newDate.toISOString().replace('T', ' ').slice(0, 19);

  // 自动解冻：仅限因使用到期自动冻结的卡
  if (card.status === 2 && card.auto_frozen_reason === 'USAGE_EXPIRED') {
    db.prepare(`
      UPDATE cards SET status = 1,
        auto_frozen_at = NULL,
        auto_frozen_reason = NULL,
        usage_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(newUsageExpiresAt, req.params.id, req.user!.userId);
  } else {
    db.prepare('UPDATE cards SET usage_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newUsageExpiresAt, req.params.id);
  }
  saveDatabase();

  res.json({
    code: 0,
    message: '使用到期时间已更新',
    data: {
      usageExpiresAt: newUsageExpiresAt,
      status: (card.status === 2 && card.auto_frozen_reason === 'USAGE_EXPIRED') ? 1 : card.status,
    },
    timestamp: Date.now(),
  });
});

export default router;
