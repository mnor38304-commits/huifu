import { Router } from 'express';
import db from '../db';
import { adminAuth, AdminRequest } from './admin-auth';

const router = Router();

// ── 仪表盘统计 ────────────────────────────────────────────────
router.get('/stats', adminAuth, (req, res) => {
  const totalUsers    = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const activeUsers   = (db.prepare('SELECT COUNT(*) as c FROM users WHERE status=1').get() as any).c;
  const kycPending    = (db.prepare('SELECT COUNT(*) as c FROM kyc_records WHERE status=0').get() as any).c;
  const totalCards    = (db.prepare('SELECT COUNT(*) as c FROM cards').get() as any).c;
  const activeCards   = (db.prepare('SELECT COUNT(*) as c FROM cards WHERE status=1').get() as any).c;
  const totalTxnToday = (db.prepare(`SELECT COUNT(*) as c FROM transactions WHERE date(txn_time)=date('now')`).get() as any).c;
  const totalVolToday = (db.prepare(`SELECT COALESCE(SUM(ABS(amount)),0) as v FROM transactions WHERE txn_type='PURCHASE' AND date(txn_time)=date('now') AND status=1`).get() as any).v;
  const totalFeeToday = (db.prepare(`SELECT COALESCE(SUM(fee),0) as v FROM transactions WHERE date(txn_time)=date('now') AND status=1`).get() as any).v;
  const pendingUsdt   = (db.prepare('SELECT COUNT(*) as c FROM usdt_orders WHERE status=0').get() as any).c;
  const totalBalance  = (db.prepare('SELECT COALESCE(SUM(balance),0) as v FROM cards WHERE status=1').get() as any).v;
  
  // 商户钱包总余额
  const walletBalanceData = (db.prepare('SELECT COALESCE(SUM(balance_usd),0) as total, COALESCE(SUM(balance_usdt),0) as totalUsdt FROM wallets').get() as any);
  const walletTotalBalance = walletBalanceData?.total || 0;
  const walletTotalUsdt = walletBalanceData?.totalUsdt || 0;

  // 近7天交易量
  const weeklyTxn = db.prepare(`
    SELECT date(txn_time) as day, COUNT(*) as count, COALESCE(SUM(ABS(amount)),0) as volume
    FROM transactions WHERE txn_time >= date('now','-7 days') AND status=1
    GROUP BY date(txn_time) ORDER BY day
  `).all();

  res.json({ code: 0, data: {
    totalUsers, activeUsers, kycPending,
    totalCards, activeCards,
    totalTxnToday, totalVolToday, totalFeeToday,
    pendingUsdt, totalBalance, weeklyTxn,
    walletTotalBalance, walletTotalUsdt
  }, timestamp: Date.now() });
});

export default router;
