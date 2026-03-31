import { Router, Response } from 'express';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types';
import { sendEmail, balanceChangeTemplate, transactionDeclinedTemplate } from '../mail';

const router = Router();

// 交易类型名称映射
const txnTypeNames: Record<string, string> = {
  PURCHASE: '消费',
  REFUND: '退款',
  TOPUP: '充值',
  FEE: '手续费',
  MONTHLY_FEE: '月费',
  CANCEL_REFUND: '销卡退款',
  AUTH: '预授权',
  AUTH_RELEASE: '授权释放'
}

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

// 创建交易（模拟商户调用，触发余额变动通知）
router.post('/', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { cardId, merchantName, amount, txnType = 'PURCHASE' } = req.body;
  
  const card = db.prepare('SELECT c.*, u.email FROM cards c LEFT JOIN users u ON c.user_id = u.id WHERE c.id = ? AND c.user_id = ?').get(cardId, req.user!.userId) as any;
  
  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }
  
  // 余额不足检查
  if (txnType === 'PURCHASE' && amount > card.balance) {
    // 获取用户邮箱并发送余额不足通知
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user!.userId) as any;
    
    if (user?.email) {
      sendEmail({
        to: user.email,
        subject: '⚠️ 交易失败 - 余额不足 - VCC虚拟卡系统',
        html: transactionDeclinedTemplate(
          card.card_no_masked,
          merchantName || '未知商户',
          amount,
          '余额不足'
        )
      }).catch(err => console.error('余额不足通知失败:', err));
    }
    
    // 创建失败交易记录
    const txnNo = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
    db.prepare(`
      INSERT INTO transactions (txn_no, card_id, user_id, txn_type, amount, currency, status, merchant_name, decline_reason, txn_time)
      VALUES (?, ?, ?, ?, ?, 'USD', 2, ?, '余额不足', CURRENT_TIMESTAMP)
    `).run(txnNo, cardId, req.user!.userId, amount, merchantName || '未知商户');
    
    return res.json({ code: 400, message: '余额不足', timestamp: Date.now() });
  }
  
  // 更新余额
  const newBalance = card.balance - amount;
  db.prepare('UPDATE cards SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newBalance, cardId);
  
  // 创建成功交易记录
  const txnNo = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
  db.prepare(`
    INSERT INTO transactions (txn_no, card_id, user_id, txn_type, amount, currency, status, merchant_name, txn_time)
    VALUES (?, ?, ?, ?, ?, 'USD', 1, ?, CURRENT_TIMESTAMP)
  `).run(txnNo, cardId, req.user!.userId, txnType, amount, merchantName || '未知商户');
  
  // 发送余额变动邮件通知
  if (card.email) {
    const typeName = txnTypeNames[txnType] || '消费';
    sendEmail({
      to: card.email,
      subject: `💳 余额变动提醒 - ${typeName} - VCC虚拟卡系统`,
      html: balanceChangeTemplate(card.card_no_masked, typeName, -amount, newBalance)
    }).catch(err => console.error('余额变动通知失败:', err));
  }
  
  res.json({
    code: 0,
    message: '交易成功',
    data: { newBalance, txnNo },
    timestamp: Date.now()
  });
});

export default router;
