import { Router } from 'express';
import db from '../db';
import { adminAuth } from './admin-auth';

const router = Router();

// ── BIN 列表 ──────────────────────────────────────────────────
router.get('/bins', adminAuth, (req, res) => {
  const { page=1, pageSize=20, status } = req.query;
  let sql = 'SELECT b.*, (SELECT COUNT(*) FROM cards WHERE bin_id=b.id) as card_count FROM card_bins b WHERE 1=1';
  const params: any[] = [];
  if (status !== undefined && status !== '') { sql += ' AND b.status=?'; params.push(Number(status)); }
  const total = (db.prepare(sql.replace('SELECT b.*, (SELECT COUNT(*) FROM cards WHERE bin_id=b.id) as card_count FROM card_bins b', 'SELECT COUNT(*) as c FROM card_bins b')).get(...params) as any).c;
  sql += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page)-1)*Number(pageSize));
  const list = db.prepare(sql).all(...params);
  res.json({ code: 0, data: { list, total }, timestamp: Date.now() });
});

// ── 创建/更新 BIN ─────────────────────────────────────────────
router.post('/bins', adminAuth, (req: any, res) => {
  const { binCode, binName, cardBrand, issuer, currency, country,
    openFee, topupFeeRate, topupFeeMin, crossBorderFeeRate,
    smallTxnThreshold, smallTxnFee, declineFee, authFee, refundFeeRate, monthlyFee } = req.body;
  if (!binCode || !binName) return res.json({ code: 400, message: '请填写BIN码和名称' });

  const existing = db.prepare('SELECT id FROM card_bins WHERE bin_code=?').get(binCode);
  if (existing) return res.json({ code: 400, message: 'BIN码已存在' });

  const result = db.prepare(`
    INSERT INTO card_bins (bin_code,bin_name,card_brand,issuer,currency,country,
      open_fee,topup_fee_rate,topup_fee_min,cross_border_fee_rate,
      small_txn_threshold,small_txn_fee,decline_fee,auth_fee,refund_fee_rate,monthly_fee)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(binCode,binName,cardBrand||'VISA',issuer||'',currency||'USD',country||'US',
    openFee||0, topupFeeRate||0.015, topupFeeMin||0, crossBorderFeeRate||0.015,
    smallTxnThreshold||1, smallTxnFee||0.1, declineFee||0.5, authFee||0, refundFeeRate||0, monthlyFee||1.0);

  db.prepare(`INSERT INTO admin_logs (admin_id,admin_name,action,target_type,target_id,detail) VALUES (?,?,?,?,?,?)`).run(
    req.admin.id, req.admin.username, '创建BIN', 'bin', result.lastInsertRowid, binCode
  );
  res.json({ code: 0, message: 'BIN创建成功', data: { id: result.lastInsertRowid }, timestamp: Date.now() });
});

router.put('/bins/:id', adminAuth, (req: any, res) => {
  const { binName, cardBrand, issuer, currency, country, status,
    openFee, topupFeeRate, topupFeeMin, crossBorderFeeRate,
    smallTxnThreshold, smallTxnFee, declineFee, authFee, refundFeeRate, monthlyFee } = req.body;

  db.prepare(`UPDATE card_bins SET
    bin_name=?,card_brand=?,issuer=?,currency=?,country=?,status=?,
    open_fee=?,topup_fee_rate=?,topup_fee_min=?,cross_border_fee_rate=?,
    small_txn_threshold=?,small_txn_fee=?,decline_fee=?,auth_fee=?,refund_fee_rate=?,monthly_fee=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(binName,cardBrand,issuer,currency,country,status,
    openFee,topupFeeRate,topupFeeMin,crossBorderFeeRate,
    smallTxnThreshold,smallTxnFee,declineFee,authFee,refundFeeRate,monthlyFee,req.params.id);

  db.prepare(`INSERT INTO admin_logs (admin_id,admin_name,action,target_type,target_id,detail) VALUES (?,?,?,?,?,?)`).run(
    req.admin.id, req.admin.username, '更新BIN费率', 'bin', req.params.id, JSON.stringify(req.body)
  );
  res.json({ code: 0, message: '更新成功', timestamp: Date.now() });
});

// ── 卡片列表 ──────────────────────────────────────────────────
router.get('/cards', adminAuth, (req, res) => {
  const { page=1, pageSize=20, keyword, status, userId } = req.query;
  let sql = `SELECT c.*, u.phone, u.email, u.user_no, b.bin_name, b.bin_code
    FROM cards c LEFT JOIN users u ON c.user_id=u.id LEFT JOIN card_bins b ON c.bin_id=b.id WHERE 1=1`;
  const params: any[] = [];
  if (keyword) { sql += ` AND (c.card_no_masked LIKE ? OR c.card_name LIKE ? OR u.phone LIKE ?)`; params.push(`%${keyword}%`,`%${keyword}%`,`%${keyword}%`); }
  if (status !== undefined && status !== '') { sql += ` AND c.status=?`; params.push(Number(status)); }
  if (userId) { sql += ` AND c.user_id=?`; params.push(Number(userId)); }

  const countSql = sql.replace(/SELECT c\.\*.*?FROM cards c/, 'SELECT COUNT(*) as c FROM cards c');
  const total = (db.prepare(countSql).get(...params) as any).c;
  sql += ` ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(pageSize), (Number(page)-1)*Number(pageSize));
  const list = db.prepare(sql).all(...params);
  res.json({ code: 0, data: { list, total }, timestamp: Date.now() });
});

// ── 冻结/解冻卡片 ─────────────────────────────────────────────
router.post('/cards/:id/status', adminAuth, (req: any, res) => {
  const { status, reason } = req.body;
  db.prepare('UPDATE cards SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
  db.prepare(`INSERT INTO admin_logs (admin_id,admin_name,action,target_type,target_id,detail) VALUES (?,?,?,?,?,?)`).run(
    req.admin.id, req.admin.username, status===2?'冻结卡片':'解冻卡片', 'card', req.params.id, reason||''
  );
  res.json({ code: 0, message: '操作成功', timestamp: Date.now() });
});

// ── 渠道配置 ──────────────────────────────────────────────────
router.get('/channels', adminAuth, (req, res) => {
  const list = db.prepare('SELECT id,channel_code,channel_name,api_base_url,status,created_at FROM card_channels').all();
  res.json({ code: 0, data: list, timestamp: Date.now() });
});

router.post('/channels', adminAuth, (req: any, res) => {
  const { channelCode, channelName, apiBaseUrl, apiKey, apiSecret, webhookSecret, configJson } = req.body;
  const result = db.prepare(`
    INSERT INTO card_channels (channel_code,channel_name,api_base_url,api_key,api_secret,webhook_secret,config_json)
    VALUES (?,?,?,?,?,?,?)
  `).run(channelCode, channelName, apiBaseUrl, apiKey, apiSecret, webhookSecret, configJson||'{}');
  res.json({ code: 0, message: '渠道创建成功', data: { id: result.lastInsertRowid }, timestamp: Date.now() });
});

router.put('/channels/:id', adminAuth, (req: any, res) => {
  const { channelName, apiBaseUrl, apiKey, apiSecret, webhookSecret, status, configJson } = req.body;
  db.prepare(`UPDATE card_channels SET channel_name=?,api_base_url=?,api_key=?,api_secret=?,webhook_secret=?,status=?,config_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(channelName, apiBaseUrl, apiKey, apiSecret, webhookSecret, status, configJson, req.params.id);
  res.json({ code: 0, message: '更新成功', timestamp: Date.now() });
});

export default router;
