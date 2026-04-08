import { Router, Response, Request, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db, { saveDatabase } from '../db';

const router = Router();

// 🔒 管理员端复用商户端相同的 JWT 密钥，统一管理
// 注意：密钥在 middleware/auth.ts 中已强制检查环境变量，此处直接引用
import { JWT_SECRET } from '../middleware/auth';

// ✅ FIX: 管理员端使用独立的 httpOnly Cookie 名称，避免与商户端 token 混淆
const ADMIN_COOKIE_NAME = 'admin_token';
const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 8 * 60 * 60 * 1000, // 8小时，与管理员 token 有效期一致
};

function setAdminCookie(res: Response, token: string) {
  res.cookie(ADMIN_COOKIE_NAME, token, ADMIN_COOKIE_OPTIONS);
}

function clearAdminCookie(res: Response) {
  res.clearCookie(ADMIN_COOKIE_NAME, { ...ADMIN_COOKIE_OPTIONS, maxAge: 0 });
}

export interface AdminRequest extends Request {
  admin?: { id: number; username: string; role: string };
}

// ── 管理员认证中间件（支持 Cookie + Authorization Header 兜底） ──
export function adminAuth(req: AdminRequest, res: Response, next: NextFunction) {
  // ✅ 优先从 httpOnly Cookie 读取
  const cookies = req.cookies as Record<string, string | undefined>;
  let token = cookies[ADMIN_COOKIE_NAME];

  // 兜底：Authorization Header
  if (!token) {
    token = req.headers.authorization?.replace('Bearer ', '') || '';
  }

  if (!token) return res.status(401).json({ code: 401, message: '未登录' });

  try {
    req.admin = jwt.verify(token, JWT_SECRET) as unknown as { id: number; username: string; role: string };
    next();
  } catch {
    res.status(401).json({ code: 401, message: 'Token无效或已过期' });
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

  // ✅ FIX: 登录成功后写入 httpOnly Cookie，防止 XSS 窃取 token
  setAdminCookie(res, token);

  res.json({
    code: 0,
    message: '登录成功',
    data: { username: admin.username, role: admin.role, realName: admin.real_name },
    timestamp: Date.now()
  });
});

// ── 管理员退出登录 ────────────────────────────────────────────
router.post('/logout', adminAuth, (req: AdminRequest, res) => {
  // ✅ FIX: 退出时清除 httpOnly Cookie，后端主动失效
  clearAdminCookie(res);
  res.json({ code: 0, message: '退出成功', timestamp: Date.now() });
});

// ── 获取当前管理员信息 ────────────────────────────────────────
router.get('/me', adminAuth, (req: AdminRequest, res) => {
  const admin = db.prepare('SELECT id, username, real_name, role, last_login, created_at FROM admins WHERE id = ?').get(req.admin!.id);
  res.json({ code: 0, data: admin, timestamp: Date.now() });
});

export default router;

