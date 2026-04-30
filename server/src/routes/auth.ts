import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../db';
import { authMiddleware, generateToken, AuthRequest, setAuthCookie, clearAuthCookie } from '../middleware/auth';
import { ApiResponse, User } from '../types';
import { sendEmail, verificationCodeTemplate, regSuccessTemplate } from '../mail';

const router = Router();

// 验证码存储 (生产环境应使用 Redis)
// ✅ FIX: 增加定期清理过期验证码，防止 Map 无限膨胀
const verificationCodes = new Map<string, { code: string; expires: number }>();

// ✅ FIX: 验证码发送频率限制，防止短信/邮箱轰炸攻击
// 限制维度：每个账号（手机/邮箱）+ 每个 IP
const rateLimitMap = new Map<string, { minuteCount: number; dayCount: number; lastMinute: number; lastDay: number }>();
const RATE_LIMIT_MINUTE = 60 * 1000;   // 每分钟最多1次
const RATE_LIMIT_DAY   = 24 * 60 * 60 * 1000; // 每天最多5次
const MAX_PER_DAY = 5;
const MAX_PER_MINUTE = 1;

function checkRateLimit(key: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record) {
    rateLimitMap.set(key, { minuteCount: 1, dayCount: 1, lastMinute: now, lastDay: now });
    return { allowed: true };
  }

  // 分钟级重置
  if (now - record.lastMinute > RATE_LIMIT_MINUTE) {
    record.minuteCount = 0;
    record.lastMinute = now;
  }
  // 天级重置
  if (now - record.lastDay > RATE_LIMIT_DAY) {
    record.dayCount = 0;
    record.lastDay = now;
  }

  if (record.minuteCount >= MAX_PER_MINUTE) {
    return { allowed: false, reason: '发送过于频繁，请1分钟后再试' };
  }
  if (record.dayCount >= MAX_PER_DAY) {
    return { allowed: false, reason: `今日发送次数已达上限（${MAX_PER_DAY}次），请明天再试或联系客服` };
  }

  record.minuteCount++;
  record.dayCount++;
  return { allowed: true };
}

// 每 10 分钟清理一次过期频率限制记录
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now - record.lastDay > RATE_LIMIT_DAY * 2) {
      rateLimitMap.delete(key);
    }
  }
}, 10 * 60 * 1000);

// 每 5 分钟清理一次过期验证码
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of verificationCodes.entries()) {
    if (entry.expires < now) {
      verificationCodes.delete(key);
    }
  }
}, 5 * 60 * 1000);

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

  // ✅ FIX: 频率限制 - 按手机号限制
  const phoneCheck = checkRateLimit(`sms:${phone}`);
  if (!phoneCheck.allowed) {
    return res.json({ code: 429, message: phoneCheck.reason!, timestamp: Date.now() });
  }

  // ✅ FIX: 频率限制 - 按 IP 限制（防止同一 IP 轰炸多个号码）
  const clientIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim() || '';
  const ipCheck = checkRateLimit(`ip:${clientIp}`);
  if (!ipCheck.allowed) {
    return res.json({ code: 429, message: `请求过于频繁，请稍后再试（IP: ${clientIp}）`, timestamp: Date.now() });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  verificationCodes.set(phone, { code, expires: Date.now() + 10 * 60 * 1000 });

  console.log(`[SMS] 验证码已发送至 ${phone}: ${code}`);

  res.json({ code: 0, message: '验证码已发送', timestamp: Date.now() });
});

// 发送邮箱验证码（真实 SMTP）
router.post('/send-email', async (req, res: Response<ApiResponse>) => {
  const { email } = req.body;

  if (!email) {
    return res.json({ code: 400, message: '请输入邮箱', timestamp: Date.now() });
  }

  // ✅ FIX: 频率限制 - 按邮箱限制
  const emailCheck = checkRateLimit(`email:${email}`);
  if (!emailCheck.allowed) {
    return res.json({ code: 429, message: emailCheck.reason!, timestamp: Date.now() });
  }

  // ✅ FIX: 频率限制 - 按 IP 限制
  const clientIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim() || '';
  const ipCheck = checkRateLimit(`ip:${clientIp}`);
  if (!ipCheck.allowed) {
    return res.json({ code: 429, message: `请求过于频繁，请稍后再试（IP: ${clientIp}）`, timestamp: Date.now() });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));

  try {
    await sendEmail({
      to: email,
      subject: 'VCC虚拟卡系统 - 邮箱验证码',
      html: verificationCodeTemplate(code)
    });

    verificationCodes.set(email, { code, expires: Date.now() + 5 * 60 * 1000 });
    // 打印验证码到日志（开发环境）
    console.log(`[Email] 验证码已发送至 ${email}: ${code}`);
    return res.json({ code: 0, message: '验证码已发送至邮箱', timestamp: Date.now() });;
  } catch (err: any) {
    console.error(`[Email] 验证码发送失败: ${email}`, err);
    return res.status(500).json({
      code: 500,
      message: err?.message?.includes('SMTP')
        ? '邮件发送失败，请检查 SMTP 配置后重试'
        : '邮件发送失败，请稍后重试',
      timestamp: Date.now()
    });
  }
});

// 用户注册
router.post('/register', async (req, res: Response<ApiResponse>) => {
  try {
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

    // 创建用户 - 使用 Promise 包装 bcryptjs 的回调 API
    console.log('[Register] 开始生成 salt...');
    const salt = await new Promise<string>((resolve, reject) => {
      bcrypt.genSalt(12, (err, salt) => {
        console.log('[Register] genSalt 回调:', { err: err?.message, saltLength: salt?.length });
        if (err) reject(err);
        else resolve(salt);
      });
    });
    console.log('[Register] salt 完成:', salt?.length);
    
    console.log('[Register] 开始生成 hash...');
    const passwordHash = await new Promise<string>((resolve, reject) => {
      bcrypt.hash(password, salt, (err, hash) => {
        console.log('[Register] hash 回调:', { err: err?.message, hashLength: hash?.length });
        if (err) reject(err);
        else resolve(hash);
      });
    });
    console.log('[Register] hash 完成:', passwordHash?.length);
    
    const userNo = generateUserNo();
    console.log('[Register] userNo 生成:', userNo);
    
    // 调试日志
    console.log('[Register] 准备插入数据库:', {
      userNo,
      phone: phone || null,
      email: email || null,
      passwordHashLength: passwordHash?.length,
      saltLength: salt?.length,
      passwordHashType: typeof passwordHash,
      saltType: typeof salt,
      passwordHashFirst20: passwordHash?.substring(0, 20),
      saltFirst20: salt?.substring(0, 20)
    });

    console.log('[Register] 执行 INSERT...');
    const result = db.prepare(`
      INSERT INTO users (user_no, phone, email, password_hash, salt, status, kyc_status)
      VALUES (?, ?, ?, ?, ?, 1, 0)
    `).run(userNo, phone || null, email || null, passwordHash, salt);
    console.log('[Register] INSERT 成功:', result.lastInsertRowid);

    const token = generateToken({ userId: result.lastInsertRowid as number, userNo });

    verificationCodes.delete(account);

    // ✅ FIX: 登录成功后写入 httpOnly Cookie，防止 XSS 窃取 token
    setAuthCookie(res, token);

    // 注册成功 - 发送邮件通知（不阻塞注册流程）
    if (email) {
      void sendEmail({
        to: email,
        subject: '🎉 注册成功 - VCC虚拟卡系统',
        html: regSuccessTemplate(userNo, phone || email)
      }).catch(err => {
        console.error(`[Email] 注册成功通知发送失败: ${email}`, err);
      });
    }

    res.json({
      code: 0,
      message: '注册成功',
      data: { userNo },
      timestamp: Date.now()
    });
  } catch (err: any) {
    console.error('[Register] 注册失败:', err?.message || err);
    console.error('[Register] 完整错误:', err);
    res.status(500).json({
      code: 500,
      message: '注册失败，请稍后重试',
      timestamp: Date.now()
    });
  }
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

  const validPassword = await new Promise<boolean>((resolve, reject) => {
    bcrypt.compare(password, user.password_hash, (err, isMatch) => {
      if (err) reject(err);
      else resolve(isMatch);
    });
  });
  if (!validPassword) {
    return res.json({ code: 400, message: '密码错误', timestamp: Date.now() });
  }

  const token = generateToken({ userId: user.id, userNo: user.user_no });

  // ✅ FIX: 登录成功后写入 httpOnly Cookie，防止 XSS 窃取 token
  setAuthCookie(res, token);

  res.json({
    code: 0,
    message: '登录成功',
    data: { userNo: user.user_no },
    timestamp: Date.now()
  });
});

// 重置密码（真实邮件通知）
router.post('/reset-password', async (req, res: Response<ApiResponse>) => {
  const { account, code, newPassword } = req.body;

  // ✅ FIX: 新密码强度验证，防止重置为弱密码
  if (!newPassword || newPassword.length < 6) {
    return res.json({ code: 400, message: '新密码至少需要6位', timestamp: Date.now() });
  }

  const storedCode = verificationCodes.get(account);
  if (!storedCode || storedCode.code !== code || storedCode.expires < Date.now()) {
    return res.json({ code: 400, message: '验证码无效或已过期', timestamp: Date.now() });
  }

  const user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ?').get(account, account) as User | undefined;
  if (!user) {
    return res.json({ code: 400, message: '账号不存在', timestamp: Date.now() });
  }

  const salt = await new Promise<string>((resolve, reject) => {
    bcrypt.genSalt(12, (err, salt) => {
      if (err) reject(err);
      else resolve(salt);
    });
  });
  
  const passwordHash = await new Promise<string>((resolve, reject) => {
    bcrypt.hash(newPassword, salt, (err, hash) => {
      if (err) reject(err);
      else resolve(hash);
    });
  });

  db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, salt, user.id);

  verificationCodes.delete(account);

  // 密码重置成功 - 发送邮件通知（不阻塞重置流程）
  if (user.email) {
    void sendEmail({
      to: user.email,
      subject: '🔐 密码重置成功 - VCC虚拟卡系统',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#52c41a;padding:24px;text-align:center;">
            <h1 style="color:#fff;margin:0;">✅ 密码重置成功</h1>
          </div>
          <div style="padding:32px;background:#fafafa;">
            <p style="font-size:16px;">您好！</p>
            <p style="font-size:16px;">您的账户密码已成功重置。</p>
            <p style="font-size:14px;color:#666;">如果这不是您本人的操作，请立即联系客服。</p>
            <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}" style="display:inline-block;background:#52c41a;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;margin-top:16px;">立即登录</a>
          </div>
          <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
            <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
          </div>
        </div>
      `
    }).catch(err => {
      console.error(`[Email] 密码重置成功通知发送失败: ${user.email}`, err);
    });
  }

  res.json({ code: 0, message: '密码重置成功', timestamp: Date.now() });
});

// ── 修改密码（登录用户） ──────────────────────────────────────────
router.post('/change-password', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const userId = req.user?.userId;
  if (!userId) {
    return res.json({ code: 401, message: '未登录', timestamp: Date.now() });
  }

  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.json({ code: 400, message: '请填写当前密码和新密码', timestamp: Date.now() });
  }
  if (newPassword.length < 8) {
    return res.json({ code: 400, message: '新密码至少需要8位', timestamp: Date.now() });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  if (!user) {
    return res.json({ code: 404, message: '用户不存在', timestamp: Date.now() });
  }

  const isMatch = await new Promise<boolean>((resolve) => {
    bcrypt.compare(oldPassword, user.password_hash, (err, result) => {
      resolve(!err && result);
    });
  });
  if (!isMatch) {
    return res.json({ code: 400, message: '当前密码错误', timestamp: Date.now() });
  }

  if (oldPassword === newPassword) {
    return res.json({ code: 400, message: '新密码不能与当前密码相同', timestamp: Date.now() });
  }

  const salt = bcrypt.genSaltSync(12);
  const passwordHash = bcrypt.hashSync(newPassword, salt);
  db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(passwordHash, salt, userId);

  console.log(`[Auth] 用户 ${userId} 密码已修改`);

  res.json({ code: 0, message: '密码修改成功', timestamp: Date.now() });
});

// 退出登录
router.post('/logout', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  // ✅ FIX: 退出时清除 httpOnly Cookie，后端主动失效
  clearAuthCookie(res);
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
// ✅ FIX: 补全空实现，实际写入数据库
router.put('/me', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const { nickname, avatar } = req.body;

  const updates: string[] = [];
  const params: any[] = [];

  if (nickname !== undefined) {
    updates.push('nickname = ?');
    params.push(nickname);
  }
  if (avatar !== undefined) {
    updates.push('avatar = ?');
    params.push(avatar);
  }

  if (updates.length === 0) {
    return res.json({ code: 0, message: '没有需要更新的字段', timestamp: Date.now() });
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.user!.userId);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ code: 0, message: '更新成功', timestamp: Date.now() });
});

export default router;
