import { Router, Response } from 'express';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types';

const router = Router();

// 获取交易列表
router.get('/', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const { cardId, txnType, status, startDate, endDate, keyword, page = 1, pageSize = 20 } = req.query;
  
  let sql = `
    SELECT t.*, c.card_no_masked, c.card_name
    FROM transactions t
    LEFT JOIN cards c ON t.card_id = c.id
    WHERE t.user_id = ?
  `;
  const params: any[] = [req.user!.userId];
  
  if (cardId) {
    sql += ' AND t.card_id = ?';
    params.push(Number(cardId));
  }
  
  if (txnType) {
    sql += ' AND t.txn_type = ?';
    params.push(txnType);
  }
  
  if (status !== undefined) {
    sql += ' AND t.status = ?';
    params.push(Number(status));
  }
  
  if (startDate) {
    sql += ' AND t.txn_time >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    sql += ' AND t.txn_time <= ?';
    params.push(endDate + ' 23:59:59');
  }
  
  if (keyword) {
    sql += ' AND t.merchant_name LIKE ?';
    params.push(`%${keyword}%`);
  }
  
  // 获取总数
  const countSql = sql.replace('SELECT t.*, c.card_no_masked, c.card_name', 'SELECT COUNT(*) as total');
  const countResult = db.prepare(countSql).get(...params) as { total: number };
  
  // 分页
  sql += ' ORDER BY t.txn_time DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));
  
  const transactions = db.prepare(sql).all(...params);
  
  res.json({
    code: 0,
    message: 'success',
    data: {
      list: transactions,
      total: countResult.total,
      page: Number(page),
      pageSize: Number(pageSize)
    },
    timestamp: Date.now()
  });
});

// 获取交易详情
router.get('/:id', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const txn = db.prepare(`
    SELECT t.*, c.card_no_masked, c.card_name
    FROM transactions t
    LEFT JOIN cards c ON t.card_id = c.id
    WHERE t.id = ? AND t.user_id = ?
  `).get(req.params.id, req.user!.userId);
  
  if (!txn) {
    return res.json({ code: 404, message: '交易不存在', timestamp: Date.now() });
  }
  
  res.json({ code: 0, message: 'success', data: txn, timestamp: Date.now() });
});

export default router;