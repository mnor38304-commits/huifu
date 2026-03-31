import { Router, Response } from 'express';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types';

const router = Router();

// 获取认证状态
router.get('/status', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const user = db.prepare('SELECT kyc_status FROM users WHERE id = ?').get(req.user!.userId) as { kyc_status: number } | undefined;
  
  if (!user) {
    return res.json({ code: 404, message: '用户不存在', timestamp: Date.now() });
  }
  
  const record = db.prepare('SELECT * FROM kyc_records WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user!.userId);
  
  res.json({
    code: 0,
    message: 'success',
    data: {
      kycStatus: user.kyc_status,
      record
    },
    timestamp: Date.now()
  });
});

// 提交认证资料
router.post('/submit', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const { subjectType, realName, idNumber, idType, idFrontUrl, idBackUrl, idHoldUrl, idExpireDate } = req.body;
  
  if (!realName || !idNumber) {
    return res.json({ code: 400, message: '请填写完整信息', timestamp: Date.now() });
  }
  
  // 检查是否已有认证记录
  const existing = db.prepare('SELECT id FROM kyc_records WHERE user_id = ? AND status IN (0, 1, 2)').get(req.user!.userId);
  if (existing) {
    return res.json({ code: 400, message: '已有认证记录', timestamp: Date.now() });
  }
  
  const result = db.prepare(`
    INSERT INTO kyc_records (user_id, subject_type, real_name, id_number, id_type, id_front_url, id_back_url, id_hold_url, id_expire_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(req.user!.userId, subjectType || 1, realName, idNumber, idType || 1, idFrontUrl, idBackUrl, idHoldUrl, idExpireDate);
  
  // 更新用户认证状态为"认证中"
  db.prepare('UPDATE users SET kyc_status = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user!.userId);
  
  // 模拟自动审核通过 (生产环境应由管理员审核)
  setTimeout(() => {
    db.prepare('UPDATE kyc_records SET status = 2, audited_at = CURRENT_TIMESTAMP WHERE id = ?').run(result.lastInsertRowid);
    db.prepare('UPDATE users SET kyc_status = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user!.userId);
  }, 2000);
  
  res.json({ code: 0, message: '认证资料已提交，正在审核中', timestamp: Date.now() });
});

// 获取认证记录
router.get('/records', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const records = db.prepare('SELECT * FROM kyc_records WHERE user_id = ? ORDER BY created_at DESC').all(req.user!.userId);
  
  res.json({ code: 0, message: 'success', data: records, timestamp: Date.now() });
});

export default router;