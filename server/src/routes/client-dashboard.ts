import { Router } from 'express';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// ── 账户概览 ──────────────────────────────────────────────────────
router.get('/overview', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const range = String(req.query.range || '30d');
  const cardId = req.query.card_id ? Number(req.query.card_id) : null;

  const days = range === 'today' ? 0 : range === '7d' ? 6 : range === 'month' ? 30 : 29;

  // 卡数据：总卡数、活跃卡数
  const totalCards = (db.prepare('SELECT COUNT(*) as c FROM cards WHERE user_id = ?').get(userId) as any)?.c || 0;
  const activeCards = (db.prepare('SELECT COUNT(*) as c FROM cards WHERE user_id = ? AND status = 1').get(userId) as any)?.c || 0;

  // 交易统计：日期过滤
  let txnWhere = 'user_id = ?';
  const txnParams: any[] = [userId];
  if (days >= 0) {
    txnWhere += ` AND txn_time >= datetime('now', '-${days} days')`;
  }
  if (cardId) { txnWhere += ' AND card_id = ?'; txnParams.push(cardId); }

  const stats = db.prepare(`
    SELECT
      COUNT(*) as totalTransactions,
      COALESCE(SUM(amount), 0) as totalAmount,
      COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) as successCount,
      COALESCE(SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END), 0) as failedCount,
      COALESCE(SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END), 0) as refundCount,
      COALESCE(SUM(CASE WHEN status = 1 AND txn_type IN ('AUTH','VERIFY') THEN 1 ELSE 0 END), 0) as verifiedCount
    FROM transactions WHERE ${txnWhere}
  `).get(...txnParams) as any;

  const totalTransactions = stats?.totalTransactions || 0;
  const totalAmount = stats?.totalAmount || 0;
  const successCount = stats?.successCount || 0;
  const failedCount = stats?.failedCount || 0;
  const refundCount = stats?.refundCount || 0;
  const verifiedCount = stats?.verifiedCount || 0;

  const successRate = totalTransactions > 0 ? Number(((successCount / totalTransactions) * 100).toFixed(2)) : 0;
  const failureRate = totalTransactions > 0 ? Number(((failedCount / totalTransactions) * 100).toFixed(2)) : 0;
  const refundRate = successCount > 0 ? Number(((refundCount / successCount) * 100).toFixed(2)) : 0;
  const verifiedRate = totalTransactions > 0 ? Number(((verifiedCount / totalTransactions) * 100).toFixed(2)) : 0;

  res.json({
    code: 0,
    data: {
      totalCards, activeCards,
      totalTransactions, totalAmount,
      successCount, failedCount, refundCount, verifiedCount,
      successRate, failureRate, refundRate, verifiedRate,
    },
    timestamp: Date.now(),
  });
});

// ── 交易趋势 ──────────────────────────────────────────────────────
router.get('/transaction-trend', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const range = String(req.query.range || '30d');
  const cardId = req.query.card_id ? Number(req.query.card_id) : null;

  const days = range === 'today' ? 0 : range === '7d' ? 6 : range === 'month' ? 30 : 29;

  let where = 'user_id = ?';
  const params: any[] = [userId];
  if (days >= 0) {
    where += ` AND txn_time >= datetime('now', '-${days} days')`;
  }
  if (cardId) { where += ' AND card_id = ?'; params.push(cardId); }

  const rows = db.prepare(`
    SELECT date(txn_time) as date,
      COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) as amount,
      COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) as success,
      COALESCE(SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END), 0) as failed,
      COALESCE(SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END), 0) as refund
    FROM transactions WHERE ${where}
    GROUP BY date(txn_time) ORDER BY date
  `).all(...params);

  res.json({ code: 0, data: rows, timestamp: Date.now() });
});

// ── 状态占比 ──────────────────────────────────────────────────────
router.get('/status-breakdown', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const range = String(req.query.range || '30d');
  const cardId = req.query.card_id ? Number(req.query.card_id) : null;

  const days = range === 'today' ? 0 : range === '7d' ? 6 : range === 'month' ? 30 : 29;

  let where = 'user_id = ?';
  const params: any[] = [userId];
  if (days >= 0) {
    where += ` AND txn_time >= datetime('now', '-${days} days')`;
  }
  if (cardId) { where += ' AND card_id = ?'; params.push(cardId); }

  const rows = db.prepare(`
    SELECT
      CASE WHEN status = 1 THEN 'SUCCESS' WHEN status = 2 THEN 'FAILED' WHEN status = 3 THEN 'REFUND' ELSE 'PENDING' END as status,
      COUNT(*) as count
    FROM transactions WHERE ${where}
    GROUP BY status ORDER BY count DESC
  `).all(...params);

  res.json({ code: 0, data: rows, timestamp: Date.now() });
});

// ── 失败原因 Top ──────────────────────────────────────────────────
router.get('/failure-reasons', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const range = String(req.query.range || '30d');
  const cardId = req.query.card_id ? Number(req.query.card_id) : null;

  const days = range === 'today' ? 0 : range === '7d' ? 6 : range === 'month' ? 30 : 29;

  let where = 'user_id = ? AND status = 2';
  const params: any[] = [userId];
  if (days >= 0) {
    where += ` AND txn_time >= datetime('now', '-${days} days')`;
  }
  if (cardId) { where += ' AND card_id = ?'; params.push(cardId); }

  // 使用 merchant_name 作为失败原因的近似（实际字段可调整）
  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(merchant_name, ''), '未知') as reason, COUNT(*) as count
    FROM transactions WHERE ${where}
    GROUP BY reason ORDER BY count DESC LIMIT 10
  `).all(...params);

  res.json({ code: 0, data: rows, timestamp: Date.now() });
});

// ── 最近交易 ──────────────────────────────────────────────────────
router.get('/recent-transactions', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const cardId = req.query.card_id ? Number(req.query.card_id) : null;
  const limit = Math.min(Number(req.query.limit) || 10, 50);

  let sql = `
    SELECT t.id, t.created_at, t.card_id, t.amount, t.currency, t.status,
      t.merchant_name as merchant, t.txn_type as type,
      t.auth_code, t.fee, t.txn_no, c.card_no_masked as card_masked
    FROM transactions t
    LEFT JOIN cards c ON t.card_id = c.id
    WHERE t.user_id = ?
  `;
  const params: any[] = [userId];
  if (cardId) { sql += ' AND t.card_id = ?'; params.push(cardId); }
  sql += ' ORDER BY t.created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params).map((r: any) => ({
    ...r,
    card_masked: r.card_masked ? `****${r.card_masked.slice(-4)}` : '****',
  }));

  res.json({ code: 0, data: rows, timestamp: Date.now() });
});

export default router;
