import { Router } from 'express';
import db from '../db';
import { adminAuth, AdminRequest } from './admin-auth';

const router = Router();

// ── 获取商户余额列表 ───────────────────────────────────────────
router.get('/list', adminAuth, (req, res) => {
  const { page = 1, pageSize = 20, keyword = '' } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);
  
  let whereClause = '1=1';
  const params: any[] = [];
  
  if (keyword) {
    whereClause += ` AND (u.user_no LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)`;
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }
  
  const list = db.prepare(`
    SELECT w.*, u.user_no, u.phone, u.email, u.status as user_status
    FROM wallets w
    LEFT JOIN users u ON w.user_id = u.id
    WHERE ${whereClause}
    ORDER BY w.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);
  
  const total = (db.prepare(`
    SELECT COUNT(*) as c FROM wallets w
    LEFT JOIN users u ON w.user_id = u.id
    WHERE ${whereClause}
  `).get(...params) as any).c;
  
  res.json({ code: 0, data: { list, total, page: Number(page), pageSize: Number(pageSize) }, timestamp: Date.now() });
});

// ── 获取单个商户余额详情 ──────────────────────────────────────
router.get('/:userId', adminAuth, (req, res) => {
  const { userId } = req.params;
  
  const wallet = db.prepare(`
    SELECT w.*, u.user_no, u.phone, u.email, u.status as user_status
    FROM wallets w
    LEFT JOIN users u ON w.user_id = u.id
    WHERE w.user_id = ?
  `).get(userId) as any;
  
  if (!wallet) {
    return res.json({ code: 404, message: '钱包不存在' });
  }
  
  // 获取最近操作记录
  const records = db.prepare(`
    SELECT * FROM wallet_adjustments
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId);
  
  res.json({ code: 0, data: { ...wallet, records }, timestamp: Date.now() });
});

// ── 调增/调减余额 ─────────────────────────────────────────────
router.post('/adjust', adminAuth, (req: AdminRequest, res) => {
  const { userId, amount, type, reason = '' } = req.body;
  const adminId = req.admin!.id;
  
  if (!userId || !amount || !type) {
    return res.json({ code: 400, message: '参数不完整' });
  }
  
  if (!['increase', 'decrease'].includes(type)) {
    return res.json({ code: 400, message: '类型只能是 increase 或 decrease' });
  }
  
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.json({ code: 400, message: '金额必须大于0' });
  }
  
  // 获取当前钱包
  let wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;
  
  // 如果钱包不存在，创建一个
  if (!wallet) {
    db.prepare(`
      INSERT INTO wallets (user_id, balance_usd, balance_usdt, locked_usd, currency)
      VALUES (?, 0, 0, 0, 'USD')
    `).run(userId);
    wallet = { balance_usd: 0, balance_usdt: 0 };
  }
  
  // 计算新余额
  const currentBalance = wallet.balance_usd || 0;
  let newBalance: number;
  
  if (type === 'increase') {
    newBalance = currentBalance + numAmount;
  } else {
    newBalance = currentBalance - numAmount;
    if (newBalance < 0) {
      return res.json({ code: 400, message: '余额不足，无法调减' });
    }
  }
  
  // 更新余额
  db.prepare('UPDATE wallets SET balance_usd = ?, updated_at = datetime("now") WHERE user_id = ?')
    .run(newBalance, userId);
  
  // 记录操作
  db.prepare(`
    INSERT INTO wallet_adjustments (user_id, admin_id, type, amount, balance_before, balance_after, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, adminId, type, numAmount, currentBalance, newBalance, reason);
  
  // 同时记录流水
  db.prepare(`
    INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, remark)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    type === 'increase' ? 'ADMIN_IN' : 'ADMIN_OUT',
    numAmount,
    currentBalance,
    newBalance,
    reason || (type === 'increase' ? '管理员调增' : '管理员调减')
  );
  
  res.json({
    code: 0,
    message: '操作成功',
    data: { balance_before: currentBalance, balance_after: newBalance },
    timestamp: Date.now()
  });
});

// ── 获取余额调整记录 ───────────────────────────────────────────
router.get('/records/:userId', adminAuth, (req, res) => {
  const { userId } = req.params;
  const { page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);
  
  const list = db.prepare(`
    SELECT wa.*, a.username as admin_name
    FROM wallet_adjustments wa
    LEFT JOIN admins a ON wa.admin_id = a.id
    WHERE wa.user_id = ?
    ORDER BY wa.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, Number(pageSize), offset);
  
  const total = (db.prepare('SELECT COUNT(*) as c FROM wallet_adjustments WHERE user_id = ?').get(userId) as any).c;
  
  res.json({ code: 0, data: { list, total, page: Number(page), pageSize: Number(pageSize) }, timestamp: Date.now() });
});

export default router;
