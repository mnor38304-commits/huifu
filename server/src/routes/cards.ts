import { Router, Response } from 'express';
import db, { getDb, saveDatabase } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse, Card } from '../types';
import { sendEmail, cardOpenedTemplate, topupSuccessTemplate } from '../mail';
import { UqPaySDK } from '../channels/uqpay';
import { getMerchantOpenableBins } from '../merchant-bin-access';

const router = Router();

// ── 渠道 SDK 工厂 ────────────────────────────────────────────────────────────

interface ChannelSDK {
  type: 'uqpay' | 'dogpay' | 'mock';
  sdk?: UqPaySDK | any; // UqPaySDK 用于类型安全的 UQPay 渠道；DogPaySDK 为动态 import，用 any 松散关联
  channel?: any;
}

/**
 * 获取当前启用的发卡渠道 SDK
 * 优先级: UQPay → DogPay → Mock
 */
async function getChannelSDK(): Promise<ChannelSDK> {
  // 1. UQPay 渠道
  const uqpayChannel = db.prepare(
    "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'UQPAY' AND status = 1"
  ).get() as any;

  if (uqpayChannel) {
    // config_json 中可配置 clientId/apiKey，也可从 api_key/api_secret 字段读取
    let config: Record<string, string> = {};
    try {
      config = JSON.parse(uqpayChannel.config_json || '{}');
    } catch (_) {}

    const sdk = new UqPaySDK({
      clientId: config.clientId || uqpayChannel.api_key || '',
      apiKey: config.apiSecret || uqpayChannel.api_secret || '',
      baseUrl: uqpayChannel.api_base_url || undefined,
    });

    // 如果 config_json 中有充值地址配置，注入到 SDK
    if (config.depositAddresses) {
      (sdk as any)._platformDepositAddresses = config.depositAddresses;
    }

    console.log('[Channel] 使用 UQPay 渠道');
    return { type: 'uqpay', sdk, channel: uqpayChannel };
  }

  // 2. DogPay 渠道（兼容旧接口）
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
  const { status } = req.query;

  let sql = `SELECT id, card_no_masked, card_name, card_type, currency, balance,
    credit_limit, single_limit, daily_limit, status, expire_date, purpose,
    created_at, bin_id, channel_code
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

  const channel = await getChannelSDK();
  let allowedBins = getMerchantOpenableBins(req.user!.userId);

  if (channel.type !== 'mock') {
    allowedBins = allowedBins.filter((bin: any) => !!bin.external_bin_id);
    channelCode = channel.type === 'uqpay' ? 'UQPAY' : 'DOGPAY';
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

  const result = db.prepare(`
    INSERT INTO cards (card_no, card_no_masked, user_id, bin_id, card_name, card_type,
      currency, balance, credit_limit, single_limit, daily_limit, status, expire_date,
      cvv, purpose, external_id, channel_code, uqpay_cardholder_id, card_order_id)
    VALUES (?, ?, ?, ?, ?, ?, 'USD', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cardNo,
    masked,
    req.user!.userId,
    selectedBinId,
    cardName,
    cardType,
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
    uqpayCardResult?.card_order_id || null
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
  const card = db.prepare(`
    SELECT id, card_no_masked, card_name, card_type, currency, balance,
      credit_limit, single_limit, daily_limit, status, expire_date, purpose,
      created_at, channel_code, external_id
    FROM cards WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user!.userId);

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  res.json({ code: 0, message: 'success', data: card, timestamp: Date.now() });
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

  try {
    const channel = await getChannelSDK();
    if (channel.type !== 'uqpay' || !channel.sdk) {
      return res.json({ code: 500, message: 'UQPay 渠道未配置', timestamp: Date.now() });
    }

    const { token, expiresIn, expiresAt } = await channel.sdk.getPanToken(card.external_id);
    const iframeUrl = channel.sdk.buildSecureIframeUrl(token, card.external_id, 'zh');

    res.json({
      code: 0,
      message: 'success',
      data: {
        iframeUrl,
        cardId: card.external_id,
        expiresIn,    // 秒，60
        expiresAt,    // ISO 8601，过期时间
      },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error('[UQPay] PAN Token 生成失败:', err.message);
    return res.json({ code: 500, message: 'PAN Token 生成失败: ' + err.message, timestamp: Date.now() });
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
  ).get(req.params.id, userId) as (Card & { email?: string }) | undefined;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.status !== 1) {
    return res.json({ code: 400, message: '卡片状态异常', timestamp: Date.now() });
  }

  // 3. 校验钱包余额
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;
  if (!wallet) {
    return res.json({ code: 400, message: '钱包不存在，请先创建钱包', timestamp: Date.now() });
  }

  if (wallet.balance_usd < numAmount) {
    return res.json({ code: 400, message: `钱包余额不足，当前余额: $${wallet.balance_usd}`, timestamp: Date.now() });
  }

  // 4. 使用事务执行：扣减钱包 → 增加卡余额 → 写流水
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

export default router;
