import { Router } from 'express';
import db, { saveDatabase } from '../db';
import { adminAuth, writeAdminLog, AdminRequest } from './admin-auth';

const router = Router();

// ── 交易列表（管理员全量）────────────────────────────────────
router.get('/', adminAuth, (req, res) => {
  const { page = 1, pageSize = 20, keyword, txnType, status, startDate, endDate, cardId } = req.query;

  let sql = `
    SELECT t.*, c.card_no_masked, c.card_name, u.phone, u.user_no
    FROM transactions t
    LEFT JOIN cards c ON t.card_id = c.id
    LEFT JOIN users u ON t.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (cardId) {
    sql += ` AND t.card_id = ?`;
    params.push(Number(cardId));
  }
  if (keyword) {
    sql += ` AND (u.phone LIKE ? OR u.user_no LIKE ? OR t.merchant_name LIKE ? OR t.txn_no LIKE ?)`;
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (txnType) {
    sql += ` AND t.txn_type = ?`;
    params.push(txnType);
  }
  if (status !== undefined && status !== '') {
    sql += ` AND t.status = ?`;
    params.push(Number(status));
  }
  if (startDate) {
    sql += ` AND t.txn_time >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND t.txn_time <= ?`;
    params.push(endDate + ' 23:59:59');
  }

  const countSql = sql.replace(
    /SELECT t\.\*.*?FROM transactions t/s,
    'SELECT COUNT(*) as c FROM transactions t'
  );
  const total = (db.prepare(countSql).get(...params) as any).c;

  sql += ` ORDER BY t.txn_time DESC LIMIT ? OFFSET ?`;
  params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

  const list = db.prepare(sql).all(...params);
  res.json({ code: 0, data: { list, total, page: Number(page), pageSize: Number(pageSize) }, timestamp: Date.now() });
});

// ── 交易统计 ──────────────────────────────────────────────────
router.get('/stats', adminAuth, (req, res) => {
  const byType = db.prepare(`
    SELECT txn_type,
           COUNT(*) as count,
           COALESCE(SUM(ABS(amount)), 0) as volume,
           COALESCE(SUM(fee), 0) as fee
    FROM transactions
    WHERE status = 1
    GROUP BY txn_type
    ORDER BY volume DESC
  `).all();

  const daily = db.prepare(`
    SELECT date(txn_time) as day,
           COUNT(*) as count,
           COALESCE(SUM(ABS(amount)), 0) as volume
    FROM transactions
    WHERE status = 1
      AND txn_time >= date('now', '-30 days')
    GROUP BY date(txn_time)
    ORDER BY day
  `).all();

  res.json({ code: 0, data: { byType, daily }, timestamp: Date.now() });
});

// ── 公告管理 ──────────────────────────────────────────────────
router.get('/notices', adminAuth, (req, res) => {
  const list = db.prepare('SELECT * FROM notices ORDER BY top DESC, created_at DESC').all();
  res.json({ code: 0, data: list, timestamp: Date.now() });
});

router.post('/notices', adminAuth, (req: any, res) => {
  const { title, content, type, top } = req.body;
  if (!title || !content) return res.json({ code: 400, message: '标题和内容不能为空' });
  const result = db.prepare(
    'INSERT INTO notices (title, content, type, status, top) VALUES (?, ?, ?, 1, ?)'
  ).run(title, content, type || 'system', top || 0);
  res.json({ code: 0, message: '发布成功', data: { id: result.lastInsertRowid }, timestamp: Date.now() });
});

router.put('/notices/:id', adminAuth, (req: any, res) => {
  const { title, content, type, status, top } = req.body;
  db.prepare(
    'UPDATE notices SET title=?, content=?, type=?, status=?, top=? WHERE id=?'
  ).run(title, content, type, status, top, req.params.id);
  res.json({ code: 0, message: '更新成功', timestamp: Date.now() });
});

router.delete('/notices/:id', adminAuth, (req, res) => {
  db.prepare('UPDATE notices SET status=0 WHERE id=?').run(req.params.id);
  res.json({ code: 0, message: '已下线', timestamp: Date.now() });
});

// ── 操作日志 ──────────────────────────────────────────────────
router.get('/logs', adminAuth, (req, res) => {
  const { page = 1, pageSize = 20 } = req.query;
  const total = (db.prepare('SELECT COUNT(*) as c FROM admin_logs').get() as any).c;
  const list = db.prepare(
    'SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(Number(pageSize), (Number(page) - 1) * Number(pageSize));
  res.json({ code: 0, data: { list, total }, timestamp: Date.now() });
});

// ── USDT 充值手续费配置 ─────────────────────────────────────────
router.get('/deposit-fee-config', adminAuth, (req, res) => {
  const channel = db.prepare(
    "SELECT config_json FROM card_channels WHERE UPPER(channel_code) = 'COINPAL' AND status = 1"
  ).get() as any;
  let feeRate = 0.05;
  let feeEnabled = true;
  if (channel && channel.config_json) {
    try {
      const cfg = JSON.parse(channel.config_json);
      if (cfg.depositFeeEnabled === false) feeEnabled = false;
      if (cfg.depositFeeRate != null) feeRate = Number(cfg.depositFeeRate);
    } catch (_) {}
  }
  res.json({
    code: 0,
    data: { feeRate, feeEnabled, provider: 'COINPAL' },
    timestamp: Date.now(),
  });
});

router.put('/deposit-fee-config', adminAuth, (req: AdminRequest, res) => {
  const { feeRate, feeEnabled } = req.body;
  if (feeRate != null && (isNaN(feeRate) || feeRate < 0 || feeRate > 0.2)) {
    return res.json({ code: 400, message: '手续费比例必须在 0~0.2 之间（如 0.05 = 5%，最高 20%）' });
  }
  const channel = db.prepare(
    "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'COINPAL' AND status = 1"
  ).get() as any;
  if (!channel) {
    return res.json({ code: 404, message: 'COINPAL 渠道未配置' });
  }
  let cfg: Record<string, any> = {};
  try { cfg = JSON.parse(channel.config_json || '{}'); } catch (_) {}
  if (feeRate != null) cfg.depositFeeRate = Number(feeRate);
  if (feeEnabled != null) cfg.depositFeeEnabled = Boolean(feeEnabled);
  db.prepare(
    'UPDATE card_channels SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(JSON.stringify(cfg), channel.id);
  if (req.admin) {
    writeAdminLog({
      adminId: req.admin.id,
      adminName: req.admin.username,
      action: 'UPDATE_DEPOSIT_FEE',
      targetType: 'card_channels',
      targetId: channel.id,
      detail: `feeRate=${cfg.depositFeeRate ?? 0.05}, feeEnabled=${cfg.depositFeeEnabled ?? true}`,
    });
  }
  res.json({
    code: 0,
    message: 'USDT 充值手续费配置已更新（需 PM2 restart 生效）',
    data: { depositFeeRate: cfg.depositFeeRate ?? 0.05, depositFeeEnabled: cfg.depositFeeEnabled ?? true },
    timestamp: Date.now(),
  });
});

export default router;
