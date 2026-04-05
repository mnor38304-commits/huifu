import { Router, Response } from 'express';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types';

const router = Router();

// 获取账单列表
router.get('/', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const bills = db.prepare('SELECT * FROM bills WHERE user_id = ? ORDER BY month DESC').all(req.user!.userId);
  
  res.json({ code: 0, message: 'success', data: bills, timestamp: Date.now() });
});

// 获取账单详情
router.get('/:id', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId);
  
  if (!bill) {
    return res.json({ code: 404, message: '账单不存在', timestamp: Date.now() });
  }
  
  // 获取该月的交易明细
  const month = (bill as any).month;
  const transactions = db.prepare(`
    SELECT t.*, c.card_no_masked, c.card_name
    FROM transactions t
    LEFT JOIN cards c ON t.card_id = c.id
    WHERE t.user_id = ? AND strftime('%Y-%m', t.txn_time) = ?
    ORDER BY t.txn_time DESC
  `).all(req.user!.userId, month);
  
  res.json({ code: 0, message: 'success', data: { bill, transactions }, timestamp: Date.now() });
});

// 获取账单统计
router.get('/statistics/overview', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  // 获取近6个月数据
  const bills = db.prepare(`
    SELECT * FROM bills 
    WHERE user_id = ? 
    ORDER BY month DESC 
    LIMIT 6
  `).all(req.user!.userId);
  
  // 本月数据
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentBill = db.prepare('SELECT * FROM bills WHERE user_id = ? AND month = ?').get(req.user!.userId, currentMonth);
  
  // 总余额
  const totalBalance = db.prepare(`
    SELECT COALESCE(SUM(balance), 0) as total FROM cards WHERE user_id = ? AND status = 1
  `).get(req.user!.userId) as { total: number };
  
  res.json({
    code: 0,
    message: 'success',
    data: {
      bills,
      currentBill: currentBill || { total_spend: 0, total_topup: 0, total_fee: 0 },
      totalBalance: totalBalance.total
    },
    timestamp: Date.now()
  });
});

export default router;