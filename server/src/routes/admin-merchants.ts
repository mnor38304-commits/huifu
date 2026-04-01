import { Router } from 'express';
import db from '../db';
import { adminAuth } from './admin-auth';

const router = Router();

router.get('/', adminAuth, (req, res) => {
  try {
    const { page = 1, pageSize = 20, keyword, status, kycStatus } = req.query;
    let sql = `SELECT u.id, u.user_no, u.phone, u.email, u.status, u.kyc_status, u.created_at FROM users u WHERE 1=1`;
    let countSql = `SELECT COUNT(*) as c FROM users WHERE 1=1`;
    const params: any[] = [];
    const countParams: any[] = [];
    if (keyword) {
      sql += ` AND (u.phone LIKE ? OR u.email LIKE ? OR u.user_no LIKE ?)`;
      countSql += ` AND (phone LIKE ? OR email LIKE ? OR user_no LIKE ?)`;
      params.push(`%${keyword}%`,`%${keyword}%`,`%${keyword}%`);
      countParams.push(`%${keyword}%`,`%${keyword}%`,`%${keyword}%`);
    }
    if (status !== undefined && status !== '') {
      sql += ` AND u.status=?`; countSql += ` AND status=?`;
      params.push(Number(status)); countParams.push(Number(status));
    }
    if (kycStatus !== undefined && kycStatus !== '') {
      sql += ` AND u.kyc_status=?`; countSql += ` AND kyc_status=?`;
      params.push(Number(kycStatus)); countParams.push(Number(kycStatus));
    }
    const total = (db.prepare(countSql).get(...countParams) as any).c;
    sql += ` ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(pageSize), (Number(page)-1)*Number(pageSize));
    const list = db.prepare(sql).all(...params);
    res.json({ code: 0, data: { list, total, page: Number(page), pageSize: Number(pageSize) }, timestamp: Date.now() });
  } catch (err: any) {
    console.error('merchants error:', err.message);
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.get('/:id', adminAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT id,user_no,phone,email,status,kyc_status,created_at FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.json({ code: 404, message: '用户不存在' });
    const cards = db.prepare('SELECT id,card_no_masked,card_name,card_type,balance,status,created_at FROM cards WHERE user_id=?').all(req.params.id);
    const kyc = db.prepare('SELECT * FROM kyc_records WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.params.id);
    const txnStats = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(ABS(amount)),0) as volume FROM transactions WHERE user_id=? AND status=1').get(req.params.id);
    res.json({ code: 0, data: { user, cards, kyc, txnStats }, timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.post('/:id/status', adminAuth, (req: any, res) => {
  try {
    const { status } = req.body;
    db.prepare('UPDATE users SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
    res.json({ code: 0, message: '操作成功', timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.post('/kyc/:kycId/audit', adminAuth, (req: any, res) => {
  try {
    const { action, rejectReason } = req.body;
    const kyc = db.prepare('SELECT * FROM kyc_records WHERE id=?').get(req.params.kycId) as any;
    if (!kyc) return res.json({ code: 404, message: 'KYC记录不存在' });
    const newStatus = action === 'approve' ? 2 : 3;
    db.prepare('UPDATE kyc_records SET status=?,reject_reason=?,auditor_id=?,audited_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(newStatus, rejectReason||null, req.admin.id, req.params.kycId);
    db.prepare('UPDATE users SET kyc_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newStatus, kyc.user_id);
    res.json({ code: 0, message: action==='approve'?'审核通过':'已拒绝', timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.get('/kyc/pending', adminAuth, (req, res) => {
  try {
    const { page=1, pageSize=20 } = req.query;
    const total = (db.prepare('SELECT COUNT(*) as c FROM kyc_records WHERE status=0').get() as any).c;
    const list = db.prepare(`SELECT k.*, u.phone, u.email, u.user_no FROM kyc_records k LEFT JOIN users u ON k.user_id=u.id WHERE k.status=0 ORDER BY k.created_at ASC LIMIT ? OFFSET ?`).all(Number(pageSize), (Number(page)-1)*Number(pageSize));
    res.json({ code: 0, data: { list, total }, timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

export default router;
