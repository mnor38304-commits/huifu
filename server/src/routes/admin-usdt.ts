import { Router } from 'express';
import db from '../db';
import { adminAuth } from './admin-auth';

const router = Router();

// ── USDT 充值订单列表 ─────────────────────────────────────────
router.get('/orders', adminAuth, (req, res) => {
  const { page=1, pageSize=20, status, keyword } = req.query;
  let sql = `SELECT o.*, u.phone, u.email, u.user_no FROM usdt_orders o
    LEFT JOIN users u ON o.user_id=u.id WHERE 1=1`;
  const params: any[] = [];
  if (status !== undefined && status !== '') { sql += ' AND o.status=?'; params.push(Number(status)); }
  if (keyword) { sql += ' AND (u.phone LIKE ? OR u.user_no LIKE ? OR o.tx_hash LIKE ?)'; params.push(`%${keyword}%`,`%${keyword}%`,`%${keyword}%`); }

  const countSql = sql.replace('SELECT o.*, u.phone, u.email, u.user_no FROM usdt_orders o', 'SELECT COUNT(*) as c FROM usdt_orders o');
  const total = (db.prepare(countSql).get(...params) as any).c;
  sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page)-1)*Number(pageSize));
  const list = db.prepare(sql).all(...params);
  res.json({ code: 0, data: { list, total }, timestamp: Date.now() });
});

// ── 手动确认 USDT 到账 ────────────────────────────────────────
router.post('/orders/:id/confirm', adminAuth, (req: any, res) => {
  const { txHash } = req.body;
  const order = db.prepare('SELECT * FROM usdt_orders WHERE id=?').get(req.params.id) as any;
  if (!order) return res.json({ code: 404, message: '订单不存在' });
  if (order.status === 2) return res.json({ code: 400, message: '订单已确认' });

  // 更新订单状态
  db.prepare('UPDATE usdt_orders SET status=2,tx_hash=?,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(txHash||order.tx_hash, req.params.id);

  // 给用户账户充值（这里简化为给第一张正常卡充值，实际应有账户余额概念）
  const txnNo = `USDT${Date.now()}${Math.floor(Math.random()*1000)}`;
  db.prepare(`INSERT INTO transactions (txn_no,card_id,user_id,txn_type,amount,fee,currency,status,merchant_name,txn_time)
    SELECT ?,id,user_id,'TOPUP',?,0,'USD',1,'USDT充值',CURRENT_TIMESTAMP FROM cards WHERE user_id=? AND status=1 LIMIT 1
  `).run(txnNo, order.amount_usd, order.user_id);

  db.prepare(`INSERT INTO admin_logs (admin_id,admin_name,action,target_type,target_id,detail) VALUES (?,?,?,?,?,?)`).run(
    req.admin.id, req.admin.username, '确认USDT到账', 'usdt_order', req.params.id, `金额:${order.amount_usdt} USDT`
  );
  res.json({ code: 0, message: '已确认到账', timestamp: Date.now() });
});

// ── 创建 USDT 充值地址（商户端调用）────────────────────────────
router.post('/create', (req, res) => {
  const { userId, amountUsdt, network } = req.body;
  if (!userId || !amountUsdt) return res.json({ code: 400, message: '参数缺失' });

  // 模拟汇率和地址（生产环境对接真实支付网关）
  const exchangeRate = 1.0;  // 1 USDT = 1 USD
  const amountUsd = amountUsdt * exchangeRate;
  const addresses: Record<string, string> = {
    TRC20: 'TRx7NqmJHkFxyz1234567890abcdefghij',
    ERC20: '0xAbCdEf1234567890abcdef1234567890AbCdEf12',
    BEP20: '0xBnBAddr1234567890abcdef1234567890BnBAddr'
  };
  const net = (network || 'TRC20') as string;
  const payAddress = addresses[net] || addresses['TRC20'];
  const orderNo = `USDT${Date.now()}${Math.floor(Math.random()*1000)}`;
  const expireAt = new Date(Date.now() + 30*60*1000).toISOString();

  const result = db.prepare(`
    INSERT INTO usdt_orders (order_no,user_id,amount_usdt,amount_usd,exchange_rate,network,pay_address,status,expire_at)
    VALUES (?,?,?,?,?,?,?,0,?)
  `).run(orderNo, userId, amountUsdt, amountUsd, exchangeRate, net, payAddress, expireAt);

  res.json({ code: 0, data: {
    orderId: result.lastInsertRowid, orderNo, amountUsdt, amountUsd,
    exchangeRate, network: net, payAddress, expireAt
  }, timestamp: Date.now() });
});

// ── USDT 统计 ─────────────────────────────────────────────────
router.get('/stats', adminAuth, (req, res) => {
  const totalOrders   = (db.prepare('SELECT COUNT(*) as c FROM usdt_orders').get() as any).c;
  const confirmedAmt  = (db.prepare(`SELECT COALESCE(SUM(amount_usdt),0) as v FROM usdt_orders WHERE status=2`).get() as any).v;
  const pendingOrders = (db.prepare('SELECT COUNT(*) as c FROM usdt_orders WHERE status=0').get() as any).c;
  const todayAmt      = (db.prepare(`SELECT COALESCE(SUM(amount_usdt),0) as v FROM usdt_orders WHERE status=2 AND date(confirmed_at)=date('now')`).get() as any).v;
  res.json({ code: 0, data: { totalOrders, confirmedAmt, pendingOrders, todayAmt }, timestamp: Date.now() });
});

export default router;
