import { Router, Response, Request, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db, { saveDatabase } from '../db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'vcc-admin-secret';

export interface AdminRequest extends Request {
  admin?: { id: number; username: string; role: string };
}

// ── 管理员认证中间件 ──────────────────────────────────────────
export function adminAuth(req: AdminRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ code: 401, message: '未登录' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET) as any;
    next();
  } catch {
    res.status(401).json({ code: 401, message: 'Token无效' });
  }
}

// ── 管理员登录 ────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND status = 1').get(username) as any;
  if (!admin) return res.json({ code: 400, message: '账号不存在或已禁用' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.json({ code: 400, message: '密码错误' });

  db.prepare('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);

  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role },
    JWT_SECRET, { expiresIn: '8h' }
  );
  res.json({ code: 0, message: '登录成功', data: { token, username: admin.username, role: admin.role, realName: admin.real_name }, timestamp: Date.now() });
});

// ── 获取当前管理员信息 ────────────────────────────────────────
router.get('/me', adminAuth, (req: AdminRequest, res) => {
  const admin = db.prepare('SELECT id, username, real_name, role, last_login, created_at FROM admins WHERE id = ?').get(req.admin!.id);
  res.json({ code: 0, data: admin, timestamp: Date.now() });
});

export default router;
