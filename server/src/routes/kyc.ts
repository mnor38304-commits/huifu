import { Router, Response } from 'express';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types';

const router = Router();

router.get('/status', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const user = db.prepare('SELECT kyc_status FROM users WHERE id = ?').get(req.user!.userId) as { kyc_status: number } | undefined;
  if (!user) {
    return res.json({ code: 404, message: '用户不存在', timestamp: Date.now() });
  }
  const record = db.prepare('SELECT * FROM kyc_records WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user!.userId);
  res.json({ code: 0, message: 'success', data: { kycStatus: user.kyc_status, record }, timestamp: Date.now() });
});

router.post('/submit', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const { subjectType, realName, idNumber, idType, idFrontUrl, idBackUrl, idHoldUrl, idExpireDate } = req.body;
    if (!realName || !idNumber) {
      return res.json({ code: 400, message: '请填写完整信息', timestamp: Date.now() });
    }

    const existing = db.prepare('SELECT id FROM kyc_records WHERE user_id = ? AND status IN (0, 1, 2)').get(req.user!.userId);
    if (existing) {
      return res.json({ code: 400, message: '已有认证记录', timestamp: Date.now() });
    }

    const subjectTypeValue = subjectType || 1;
    const idTypeValue = idType || (subjectTypeValue === 2 ? 3 : 1);
    const idFrontUrlValue = idFrontUrl || null;
    const idBackUrlValue = idBackUrl || null;
    const idHoldUrlValue = idHoldUrl || null;
    const idExpireDateValue = idExpireDate || null;

    const result = db.prepare(`
      INSERT INTO kyc_records (user_id, subject_type, real_name, id_number, id_type, id_front_url, id_back_url, id_hold_url, id_expire_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      req.user!.userId,
      subjectTypeValue,
      realName,
      idNumber,
      idTypeValue,
      idFrontUrlValue,
      idBackUrlValue,
      idHoldUrlValue,
      idExpireDateValue
    );

    db.prepare('UPDATE users SET kyc_status = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user!.userId);

    setTimeout(() => {
      try {
        db.prepare('UPDATE kyc_records SET status = 2, audited_at = CURRENT_TIMESTAMP WHERE id = ?').run(result.lastInsertRowid);
        db.prepare('UPDATE users SET kyc_status = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user!.userId);
      } catch (err) {
        console.error('[KYC] auto audit failed', err);
      }
    }, 2000);

    return res.json({ code: 0, message: '认证资料已提交，正在审核中', timestamp: Date.now() });
  } catch (err: any) {
    console.error('[KYC] submit failed', err);
    return res.status(500).json({ code: 500, message: err?.message || '实名认证提交失败', timestamp: Date.now() });
  }
});

router.get('/records', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const records = db.prepare('SELECT * FROM kyc_records WHERE user_id = ? ORDER BY created_at DESC').all(req.user!.userId);
  res.json({ code: 0, message: 'success', data: records, timestamp: Date.now() });
});

export default router;
