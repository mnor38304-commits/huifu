/**
 * Admin 端 — 卡片与持卡人管理
 *
 * 路由前缀: /api/admin/cards（已在 index.ts 中挂载）
 *
 * 功能:
 *  - 持卡人管理（DogPay 渠道）
 *  - BIN 段管理（已有 CRUD）
 *  - 渠道配置管理（已有）
 *  - DogPay BIN 同步
 */

import { Router, Response } from 'express';
import db from '../db';
import { adminAuth, AdminRequest } from './admin-auth';

const router = Router();

// 所有路由需要管理员认证
router.use(adminAuth);

// ── 工具: 获取 DogPay SDK ────────────────────────────────────────────────────

async function getDogPaySDK() {
  const channel = db.prepare(
    "SELECT * FROM card_channels WHERE channel_code = 'dogpay' AND status = 1"
  ).get() as any;

  if (!channel) return null;

  try {
    const { DogPaySDK } = await import('../channels/dogpay');
    return new DogPaySDK({
      appId: channel.api_key,
      appSecret: channel.api_secret,
      apiBaseUrl: channel.api_base_url,
    });
  } catch (err: any) {
    console.error('[AdminCards] DogPay SDK 加载失败:', err.message);
    return null;
  }
}

// ── 工具: 初始化持卡人表 ─────────────────────────────────────────────────────

function initCardholderTable() {
  try {
    const database = (db as any).getDb?.() || db;
    database.run(`
      CREATE TABLE IF NOT EXISTS dogpay_cardholders (
        id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        dogpay_id        VARCHAR(64)  NOT NULL UNIQUE COMMENT 'DogPay 持卡人 ID',
        first_name       VARCHAR(64)  NOT NULL COMMENT '名',
        last_name        VARCHAR(64)  NOT NULL COMMENT '姓',
        email            VARCHAR(128) NOT NULL COMMENT '邮箱',
        phone            VARCHAR(32)  NULL COMMENT '手机号',
        country_code     VARCHAR(8)   DEFAULT 'US',
        status           VARCHAR(16)  DEFAULT 'PENDING',
        kyc_status       VARCHAR(16)  DEFAULT 'PENDING',
        created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email  (email),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='DogPay 持卡人缓存表'
    `);
  } catch (e) { /* 表可能已存在 */ }
}

// ── 工具: 同步 DogPay 持卡人到本地 ───────────────────────────────────────────

async function syncCardholderToDb(dogpayCardholder: any) {
  initCardholderTable();
  db.prepare(`
    INSERT INTO dogpay_cardholders
      (dogpay_id, first_name, last_name, email, phone, country_code, status, kyc_status)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      first_name   = VALUES(first_name),
      last_name    = VALUES(last_name),
      email        = VALUES(email),
      phone        = VALUES(phone),
      country_code = VALUES(country_code),
      status       = VALUES(status),
      kyc_status   = VALUES(kyc_status),
      updated_at   = CURRENT_TIMESTAMP
  `).run(
    dogpayCardholder.id,
    dogpayCardholder.firstName,
    dogpayCardholder.lastName,
    dogpayCardholder.email,
    dogpayCardholder.phone,
    dogpayCardholder.countryCode,
    dogpayCardholder.status,
    dogpayCardholder.kycStatus,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 持卡人管理
// ═══════════════════════════════════════════════════════════════════════════════

// ── 持卡人列表 ────────────────────────────────────────────────────────────────
router.get('/cardholders', async (req: AdminRequest, res: Response) => {
  const { page = 1, pageSize = 20, status, keyword } = req.query;

  // 优先查本地缓存表（响应快）
  const localCount = (db.prepare(
    "SELECT COUNT(*) as c FROM dogpay_cardholders"
  ).get() as any).c;

  if (localCount > 0) {
    // 本地模式
    let sql = 'SELECT * FROM dogpay_cardholders WHERE 1=1';
    const params: any[] = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (keyword) {
      sql += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const total = (db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as c'), ...params).get(...params) as any).c;
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

    const list = db.prepare(sql).all(...params);

    return res.json({
      code: 0,
      data: { list, total, page: Number(page), pageSize: Number(pageSize), source: 'local' },
      timestamp: Date.now(),
    });
  }

  // 无本地数据 → 查 DogPay API
  const sdk = await getDogPaySDK();
  if (!sdk) {
    return res.json({
      code: 503,
      message: 'DogPay 渠道未配置或未启用',
      timestamp: Date.now(),
    });
  }

  try {
    const result = await sdk.listCardholders({
      page: Number(page),
      pageSize: Number(pageSize),
      status: status as string,
      keyword: keyword as string,
    });

    return res.json({
      code: 0,
      data: { list: result.list, total: result.total, page: Number(page), pageSize: Number(pageSize), source: 'dogpay' },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return res.json({ code: 500, message: '获取持卡人列表失败: ' + err.message, timestamp: Date.now() });
  }
});

// ── 持卡人详情 ────────────────────────────────────────────────────────────────
router.get('/cardholders/:id', async (req: AdminRequest, res: Response) => {
  // 先查本地
  const local = db.prepare('SELECT * FROM dogpay_cardholders WHERE id = ? OR dogpay_id = ?').get(req.params.id, req.params.id) as any;

  if (local) {
    return res.json({ code: 0, data: local, source: 'local', timestamp: Date.now() });
  }

  const sdk = await getDogPaySDK();
  if (!sdk) {
    return res.json({ code: 503, message: 'DogPay 渠道未配置', timestamp: Date.now() });
  }

  try {
    const cardholder = await sdk.getCardholder(req.params.id);
    await syncCardholderToDb(cardholder);
    return res.json({ code: 0, data: cardholder, source: 'dogpay', timestamp: Date.now() });
  } catch (err: any) {
    return res.json({ code: 404, message: '持卡人不存在: ' + err.message, timestamp: Date.now() });
  }
});

// ── 创建持卡人 ───────────────────────────────────────────────────────────────
router.post('/cardholders', async (req: AdminRequest, res: Response) => {
  const { firstName, lastName, email, phone, countryCode, idType, idNumber } = req.body;

  if (!firstName || !lastName || !email) {
    return res.json({ code: 400, message: '姓名和邮箱为必填项', timestamp: Date.now() });
  }

  const sdk = await getDogPaySDK();
  if (!sdk) {
    return res.json({ code: 503, message: 'DogPay 渠道未配置或未启用', timestamp: Date.now() });
  }

  try {
    const cardholder = await sdk.createCardholder({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || '',
      countryCode: countryCode || 'US',
      idType: idType ?? 0,
      idNumber: idNumber || '',
    });

    // 同步到本地缓存表
    await syncCardholderToDb(cardholder);

    console.log(`[AdminCards] 创建持卡人成功: ${cardholder.id} (${email})`);
    return res.json({
      code: 0,
      message: '持卡人创建成功',
      data: cardholder,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error('[AdminCards] 创建持卡人失败:', err.message);
    return res.json({ code: 500, message: '创建持卡人失败: ' + err.message, timestamp: Date.now() });
  }
});

// ── 更新持卡人状态 ───────────────────────────────────────────────────────────
router.put('/cardholders/:id/status', async (req: AdminRequest, res: Response) => {
  const { status } = req.body;
  if (!['ACTIVE', 'DISABLED'].includes(status)) {
    return res.json({ code: 400, message: 'status 仅支持 ACTIVE / DISABLED', timestamp: Date.now() });
  }

  const sdk = await getDogPaySDK();
  if (!sdk) {
    return res.json({ code: 503, message: 'DogPay 渠道未配置', timestamp: Date.now() });
  }

  // 支持通过 dogpay_id 或本地 id 更新
  const local = db.prepare('SELECT dogpay_id FROM dogpay_cardholders WHERE id = ?').get(req.params.id) as any;
  const cardholderId = local?.dogpay_id || req.params.id;

  try {
    await sdk.updateCardholderStatus(cardholderId, status);

    // 更新本地缓存
    db.prepare('UPDATE dogpay_cardholders SET status = ? WHERE dogpay_id = ? OR id = ?')
      .run(status, cardholderId, req.params.id);

    return res.json({ code: 0, message: `持卡人状态已更新为 ${status}`, timestamp: Date.now() });
  } catch (err: any) {
    return res.json({ code: 500, message: '更新状态失败: ' + err.message, timestamp: Date.now() });
  }
});

// ── 同步所有持卡人到本地 ─────────────────────────────────────────────────────
router.post('/cardholders/sync', async (req: AdminRequest, res: Response) => {
  const sdk = await getDogPaySDK();
  if (!sdk) {
    return res.json({ code: 503, message: 'DogPay 渠道未配置', timestamp: Date.now() });
  }

  try {
    initCardholderTable();
    let page = 1;
    const pageSize = 100;
    let synced = 0;

    while (true) {
      const result = await sdk.listCardholders({ page, pageSize });
      if (!result.list || result.list.length === 0) break;

      for (const ch of result.list) {
        await syncCardholderToDb(ch);
        synced++;
      }

      if (result.list.length < pageSize) break;
      page++;
    }

    return res.json({
      code: 0,
      message: `同步完成，共 ${synced} 条`,
      data: { synced },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return res.json({ code: 500, message: '同步失败: ' + err.message, timestamp: Date.now() });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BIN 段管理（现有功能，保持兼容）
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/bins', (req: AdminRequest, res: Response) => {
  const { page = 1, pageSize = 50, brand, currency } = req.query;

  let sql = 'SELECT * FROM card_bins WHERE 1=1';
  const params: any[] = [];

  if (brand) { sql += ' AND card_brand = ?'; params.push(brand); }
  if (currency) { sql += ' AND currency = ?'; params.push(currency); }

  const total = (db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as c'), ...params).get(...params) as any).c;
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

  const list = db.prepare(sql).all(...params);
  res.json({ code: 0, data: { list, total, page: Number(page), pageSize: Number(pageSize) }, timestamp: Date.now() });
});

router.post('/bins', (req: AdminRequest, res: Response) => {
  const { binCode, binName, cardBrand, issuer, currency, country, cardType,
    openFee, topupFeeRate, topupFeeMin, crossBorderFeeRate,
    smallTxnThreshold, smallTxnFee, declineFee, authFee, refundFeeRate,
    monthlyFee, riskLevel } = req.body;

  if (!binCode || !binName || !cardBrand) {
    return res.json({ code: 400, message: 'binCode / binName / cardBrand 为必填', timestamp: Date.now() });
  }

  const result = db.prepare(`
    INSERT INTO card_bins (bin_code, bin_name, card_brand, issuer, currency, country, card_type,
      open_fee, topup_fee_rate, topup_fee_min, cross_border_fee_rate,
      small_txn_threshold, small_txn_fee, decline_fee, auth_fee, refund_fee_rate,
      monthly_fee, risk_level, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    binCode, binName, cardBrand, issuer || '', currency || 'USD',
    country || 'US', cardType ?? 0,
    openFee ?? 0, topupFeeRate ?? 0, topupFeeMin ?? 0, crossBorderFeeRate ?? 0,
    smallTxnThreshold ?? 0, smallTxnFee ?? 0, declineFee ?? 0, authFee ?? 0,
    refundFeeRate ?? 0, monthlyFee ?? 0, riskLevel ?? 0,
  );

  res.json({ code: 0, message: 'BIN 创建成功', data: { id: result.lastInsertRowid }, timestamp: Date.now() });
});

router.put('/bins/:id', (req: AdminRequest, res: Response) => {
  const { binName, cardBrand, issuer, currency, country, status } = req.body;

  db.prepare(`
    UPDATE card_bins SET bin_name=?, card_brand=?, issuer=?, currency=?, country=?, status=?
    WHERE id=?
  `).run(binName, cardBrand, issuer, currency, country, status ?? 1, req.params.id);

  res.json({ code: 0, message: 'BIN 更新成功', timestamp: Date.now() });
});

// ── 批量更新 BIN 费率 ────────────────────────────────────────────────────────
router.post('/bins/batch-rates', (req: AdminRequest, res: Response) => {
  const { ids, rates } = req.body; // rates: [{ id, openFee, topupFeeRate, ... }]

  if (!Array.isArray(rates)) {
    return res.json({ code: 400, message: 'rates 必须为数组', timestamp: Date.now() });
  }

  for (const rate of rates) {
    const bin = db.prepare('SELECT id FROM card_bins WHERE id = ?').get(rate.id);
    if (bin) {
      db.prepare(`
        UPDATE card_bins SET open_fee=?, topup_fee_rate=?, topup_fee_min=?,
          cross_border_fee_rate=?, monthly_fee=?
        WHERE id=?
      `).run(
        rate.openFee ?? 0, rate.topupFeeRate ?? 0, rate.topupFeeMin ?? 0,
        rate.crossBorderFeeRate ?? 0, rate.monthlyFee ?? 0, rate.id,
      );
    }
  }

  res.json({ code: 0, message: `已更新 ${rates.length} 个 BIN 的费率`, timestamp: Date.now() });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 渠道配置管理（现有功能，保持兼容）
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/channels', (_req: AdminRequest, res: Response) => {
  const list = db.prepare('SELECT * FROM card_channels ORDER BY priority ASC').all();
  res.json({ code: 0, data: list, timestamp: Date.now() });
});

router.post('/channels', (req: AdminRequest, res: Response) => {
  const { channelCode, channelName, apiBaseUrl, apiKey, apiSecret, status, priority, configJson } = req.body;
  if (!channelCode || !channelName) {
    return res.json({ code: 400, message: 'channelCode / channelName 为必填', timestamp: Date.now() });
  }

  db.prepare(`
    INSERT INTO card_channels (channel_code, channel_name, api_base_url, api_key, api_secret, status, priority, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      channel_name = VALUES(channel_name),
      api_base_url = VALUES(api_base_url),
      api_key      = VALUES(api_key),
      api_secret   = VALUES(api_secret),
      status       = VALUES(status),
      priority     = VALUES(priority),
      config_json  = VALUES(config_json)
  `).run(channelCode, channelName, apiBaseUrl || '', apiKey || '', apiSecret || '',
    status ?? 0, priority ?? 99, configJson || '{}');

  res.json({ code: 0, message: '渠道配置已保存', timestamp: Date.now() });
});

// ── DogPay BIN 同步 ──────────────────────────────────────────────────────────
router.post('/channels/dogpay/sync-bins', async (req: AdminRequest, res: Response) => {
  const sdk = await getDogPaySDK();
  if (!sdk) {
    return res.json({ code: 503, message: 'DogPay 渠道未启用', timestamp: Date.now() });
  }

  try {
    const data = await sdk.request<any>('GET', '/api/v1/products', {});
    const products = data.data?.list || data.list || [];

    let synced = 0;
    for (const product of products) {
      const binCode = String(product.bin_code || product.binCode || '').slice(0, 6);
      if (!binCode) continue;

      db.prepare(`
        INSERT INTO card_bins (bin_code, bin_name, card_brand, issuer, currency, country, card_type, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          bin_name   = VALUES(bin_name),
          card_brand = VALUES(card_brand),
          issuer     = VALUES(issuer),
          currency   = VALUES(currency)
      `).run(
        binCode,
        product.name || product.product_name || `BIN ${binCode}`,
        product.network || product.card_network || 'VISA',
        product.issuer || 'DogPay',
        product.currency || 'USD',
        product.country || 'US',
        product.card_type === 'PHYSICAL' ? 1 : 0,
      );
      synced++;
    }

    return res.json({ code: 0, message: `DogPay BIN 同步完成: ${synced} 个`, timestamp: Date.now() });
  } catch (err: any) {
    return res.json({ code: 500, message: 'BIN 同步失败: ' + err.message, timestamp: Date.now() });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 卡片列表（管理员视角）
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/cards', (req: AdminRequest, res: Response) => {
  const { page = 1, pageSize = 20, status, keyword, channelCode } = req.query;

  let sql = `
    SELECT c.*, u.phone, u.email, u.user_no, bb.bin_code
    FROM cards c
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN card_bins bb ON c.bin_id = bb.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status !== undefined && status !== '') {
    sql += ' AND c.status = ?';
    params.push(Number(status));
  }
  if (channelCode) {
    sql += ' AND c.channel_code = ?';
    params.push(channelCode);
  }
  if (keyword) {
    sql += ' AND (u.phone LIKE ? OR u.email LIKE ? OR c.card_no_masked LIKE ? OR c.card_name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const total = (db.prepare(sql.replace(/SELECT c\.\*.*?FROM/, 'SELECT COUNT(*) as c FROM')).get(...params) as any).c;
  sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

  const list = db.prepare(sql).all(...params);
  res.json({ code: 0, data: { list, total, page: Number(page), pageSize: Number(pageSize) }, timestamp: Date.now() });
});

// ── 管理员更新卡片状态 ────────────────────────────────────────────────────────
router.post('/cards/:id/status', async (req: AdminRequest, res: Response) => {
  const { status, reason } = req.body;
  if (![0, 1, 2].includes(Number(status))) {
    return res.json({ code: 400, message: 'status 仅支持 0-未激活 / 1-正常 / 2-冻结', timestamp: Date.now() });
  }

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id) as any;
  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  // 尝试通过渠道 SDK 冻结/解冻
  const sdk = await getDogPaySDK();
  if (sdk && card.external_id && card.channel_code === 'DOGPAY') {
    try {
      if (status === 2) await sdk.freezeCard(card.external_id);
      else if (status === 1) await sdk.unfreezeCard(card.external_id);
    } catch (err: any) {
      console.error('[AdminCards] DogPay 卡片状态更新失败:', err.message);
    }
  }

  db.prepare('UPDATE cards SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ code: 0, message: `卡片状态已更新为 ${status}`, timestamp: Date.now() });
});

export default router;
