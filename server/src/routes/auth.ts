import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { authMiddleware, generateToken, AuthRequest } from '../middleware/auth';
import { ApiResponse, User } from '../types';

const router = Router();

// 验证码存储 (生产环境应使用 Redis)
const verificationCodes = new Map<string, { code: string; expires: number }>();

// 生成用户编号
function generateUserNo(): string {
  const date = new Date();
  const prefix = `VCC${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}${suffix}`;
}

// 发送短信验证码
router.post('/send-sms', (req, res: Response<ApiResponse>) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.json({ code: 400, message: '请输入手机号', timestamp: Date.now() });
  }
  
  const code = String(Math.floor(100000 + Math.random() * 900000));
  verificationCodes.set(phone, { code, expires: Date.now() + 10 * 60 * 1000 });
  
  console.log(`[SMS] 验证码已发送至 ${phone}: ${code}`);
  
  res.json({ code: 0, message: '验证码已发送', data: { mockCode: code }, timestamp: Date.now() });
});

// 发送邮箱验证码
router.post('/send-email', (req, res: Response<ApiResponse>) => {
  const { email } = req.body;
  
  if (!email) {
    return res.json({ code: 400, message: '请输入邮箱', timestamp: Date.now() });
  }
  
  const code = String(Math.floor(100000 + Math.random() * 900000));
  verificationCodes.set(email, { code, expires: Date.now() + 10 * 60 * 1000 });
  
  console.log(`[Email] 验证码已发送至 ${email}: ${code}`);
  
  res.json({ code: 0, message: '验证码已发送', data: { mockCode: code }, timestamp: Date.now() });
});

// 用户注册
router.post('/register', async (req, res: Response<ApiResponse>) => {
  const { phone, email, password, code } = req.body;
  
  if (!password || password.length < 6) {
    return res.json({ code: 400, message: '密码至少6位', timestamp: Date.now() });
  }
  
  if (!phone && !email) {
    return res.json({ code: 400, message: '请输入手机号或邮箱', timestamp: Date.now() });
  }
  
  const account = phone || email;
  
  // 验证验证码
  const storedCode = verificationCodes.get(account);
  if (!storedCode || storedCode.code !== code || storedCode.expires < Date.now()) {
    return res.json({ code: 400, message: '验证码无效或已过期', timestamp: Date.now() });
  }
  
  // 检查账号是否已存在
  const existing = db.prepare('SELECT id FROM users WHERE phone = ? OR email = ?').get(phone, email);
  if (existing) {
    return res.json({ code: 400, message: '该账号已注册', timestamp: Date.now() });
  }
  
  // 创建用户
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(password, salt);
  const userNo = generateUserNo();
  
  const result = db.prepare(`
    INSERT INTO users (user_no, phone, email, password_hash, salt, status, kyc_status)
    VALUES (?, ?, ?, ?, ?, 1, 0)
  `).run(userNo, phone || null, email || null, passwordHash, salt);
  
  const token = generateToken({ userId: result.lastInsertRowid as number, userNo });
  
  verificationCodes.delete(account);
  
  res.json({
    code: 0,
    message: '注册成功',
    data: { token, userNo },
    timestamp: Date.now()
  });
});

// 用户登录
router.post('/login', async (req, res: Response<ApiResponse>) => {
  const { account, password } = req.body;
  
  if (!account || !password) {
    return res.json({ code: 400, message: '请输入账号和密码', timestamp: Date.now() });
  }
  
  const user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ? OR user_no = ?').get(account, account, account) as User | undefined;
  
  if (!user) {
    return res.json({ code: 400, message: '账号不存在', timestamp: Date.now() });
  }
  
  if (user.status !== 1) {
    return res.json({ code: 400, message: '账号已被禁用', timestamp: Date.now() });
  }
  
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    return res.json({ code: 400, message: '密码错误', timestamp: Date.now() });
  }
  
  const token = generateToken({ userId: user.id, userNo: user.user_no });
  
  res.json({
    code: 0,
    message: '登录成功',
    data: { token, userNo: user.user_no },
    timestamp: Date.now()
  });
});

// 重置密码
router.post('/reset-password', async (req, res: Response<ApiResponse>) => {
  const { account, code, newPassword } = req.body;
  
  const storedCode = verificationCodes.get(account);
  if (!storedCode || storedCode.code !== code || storedCode.expires < Date.now()) {
    return res.json({ code: 400, message: '验证码无效或已过期', timestamp: Date.now() });
  }
  
  const user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ?').get(account, account) as User | undefined;
  if (!user) {
    return res.json({ code: 400, message: '账号不存在', timestamp: Date.now() });
  }
  
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(newPassword, salt);
  
  db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, salt, user.id);
  
  verificationCodes.delete(account);
  
  res.json({ code: 0, message: '密码重置成功', timestamp: Date.now() });
});

// 退出登录
router.post('/logout', authMiddleware, (req, res: Response<ApiResponse>) => {
  res.json({ code: 0, message: '退出成功', timestamp: Date.now() });
});

// 获取当前用户信息
router.get('/me', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const user = db.prepare(`
    SELECT id, user_no, phone, email, status, kyc_status, created_at 
    FROM users WHERE id = ?
  `).get(req.user!.userId);
  
  if (!user) {
    return res.json({ code: 404, message: '用户不存在', timestamp: Date.now() });
  }
  
  res.json({ code: 0, message: 'success', data: user, timestamp: Date.now() });
});

// 更新用户信息
router.put('/me', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const { nickname, avatar } = req.body;
  
  // 这里可以扩展用户信息表
  res.json({ code: 0, message: '更新成功', timestamp: Date.now() });
});

export default router;