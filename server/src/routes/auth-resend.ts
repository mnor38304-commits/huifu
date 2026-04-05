import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { authMiddleware, generateToken, AuthRequest } from '../middleware/auth';
import { ApiResponse, User } from '../types';
import { sendEmail, verificationCodeTemplate, regSuccessTemplate, passwordResetTemplate } from '../mailer';
import { saveVerificationCode, getVerificationCode, deleteVerificationCode, cleanupExpiredVerificationCodes, VerificationChannel } from '../verification-code-store';

const router = Router();

function generateUserNo(): string {
  const date = new Date();
  const prefix = `VCC${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}${suffix}`;
}

function getChannelByAccount(account?: string): VerificationChannel {
  return account && account.includes('@') ? 'email' : 'phone'
}

router.post('/send-sms', (req, res: Response<ApiResponse>) => {
  const { phone } = req.body;
  if (!phone) {
    return res.json({ code: 400, message: '请输入手机号', timestamp: Date.now() });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  saveVerificationCode(phone, 'phone', code, 10 * 60 * 1000);
  console.log(`[SMS] 验证码已发送至 ${phone}: ${code}`);
  return res.json({ code: 0, message: '验证码已发送', data: { mockCode: code }, timestamp: Date.now() });
});

router.post('/send-email', async (req, res: Response<ApiResponse>) => {
  const { email } = req.body;
  if (!email) {
    return res.json({ code: 400, message: '请输入邮箱', timestamp: Date.now() });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  try {
    await sendEmail({
      to: email,
      subject: 'VCC虚拟卡系统 - 邮箱验证码',
      html: verificationCodeTemplate(code)
    });
    saveVerificationCode(email, 'email', code, 5 * 60 * 1000);
    return res.json({ code: 0, message: '验证码已发送至邮箱', timestamp: Date.now() });
  } catch (err: any) {
    console.error(`[Email] 验证码发送失败: ${email}`, err);
    return res.status(500).json({
      code: 500,
      message: err?.message?.includes('RESEND')
        ? '邮件发送失败，请检查 RESEND 配置后重试'
        : '邮件发送失败，请稍后重试',
      timestamp: Date.now()
    });
  }
});

router.post('/register', async (req, res: Response<ApiResponse>) => {
  try {
    const { phone, email, password, code } = req.body;

    console.log('[Register] 开始注册', { hasPhone: !!phone, hasEmail: !!email });
    cleanupExpiredVerificationCodes();

    if (!password || password.length < 6) {
      return res.json({ code: 400, message: '密码至少6位', timestamp: Date.now() });
    }
    if (!phone && !email) {
      return res.json({ code: 400, message: '请输入手机号或邮箱', timestamp: Date.now() });
    }

    const account = phone || email;
    const channel = getChannelByAccount(account);
    const storedCode = getVerificationCode(account, channel);
    if (!storedCode || storedCode.code !== code || storedCode.expires_at < Date.now()) {
      return res.json({ code: 400, message: '验证码无效或已过期', timestamp: Date.now() });
    }

    const existing = db.prepare('SELECT id FROM users WHERE phone = ? OR email = ?').get(phone, email);
    if (existing) {
      return res.json({ code: 400, message: '该账号已注册', timestamp: Date.now() });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);
    const userNo = generateUserNo();

    const result = db.prepare(`
      INSERT INTO users (user_no, phone, email, password_hash, salt, status, kyc_status)
      VALUES (?, ?, ?, ?, ?, 1, 0)
    `).run(userNo, phone || null, email || null, passwordHash, salt);

    const token = generateToken({ userId: result.lastInsertRowid as number, userNo });
    deleteVerificationCode(account, channel);

    console.log('[Register] 注册写库成功', { userNo, userId: result.lastInsertRowid });

    if (email) {
      void sendEmail({
        to: email,
        subject: '🎉 注册成功 - VCC虚拟卡系统',
        html: regSuccessTemplate(userNo, phone || email)
      }).catch(err => {
        console.error(`[Email] 注册成功通知发送失败: ${email}`, err);
      });
    }

    return res.json({
      code: 0,
      message: '注册成功',
      data: { token, userNo },
      timestamp: Date.now()
    });
  } catch (err: any) {
    console.error('[Register] 注册失败', err);
    return res.status(500).json({
      code: 500,
      message: err?.message || '注册失败，请稍后重试',
      timestamp: Date.now()
    });
  }
});

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
  return res.json({ code: 0, message: '登录成功', data: { token, userNo: user.user_no }, timestamp: Date.now() });
});

router.post('/reset-password', async (req, res: Response<ApiResponse>) => {
  try {
    const { account, code, newPassword } = req.body;
    cleanupExpiredVerificationCodes();
    const channel = getChannelByAccount(account);
    const storedCode = getVerificationCode(account, channel);
    if (!storedCode || storedCode.code !== code || storedCode.expires_at < Date.now()) {
      return res.json({ code: 400, message: '验证码无效或已过期', timestamp: Date.now() });
    }
    const user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ?').get(account, account) as User | undefined;
    if (!user) {
      return res.json({ code: 400, message: '账号不存在', timestamp: Date.now() });
    }
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, salt, user.id);
    deleteVerificationCode(account, channel);
    if (user.email) {
      void sendEmail({
        to: user.email,
        subject: '🔐 密码重置成功 - VCC虚拟卡系统',
        html: passwordResetTemplate(code)
      }).catch(err => {
        console.error(`[Email] 密码重置成功通知发送失败: ${user.email}`, err);
      });
    }
    return res.json({ code: 0, message: '密码重置成功', timestamp: Date.now() });
  } catch (err: any) {
    console.error('[ResetPassword] 密码重置失败', err);
    return res.status(500).json({ code: 500, message: err?.message || '密码重置失败，请稍后重试', timestamp: Date.now() });
  }
});

router.post('/logout', authMiddleware, (req, res: Response<ApiResponse>) => {
  return res.json({ code: 0, message: '退出成功', timestamp: Date.now() });
});

router.get('/me', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const user = db.prepare(`
    SELECT id, user_no, phone, email, status, kyc_status, created_at 
    FROM users WHERE id = ?
  `).get(req.user!.userId);
  if (!user) {
    return res.json({ code: 404, message: '用户不存在', timestamp: Date.now() });
  }
  return res.json({ code: 0, message: 'success', data: user, timestamp: Date.now() });
});

router.put('/me', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  return res.json({ code: 0, message: '更新成功', timestamp: Date.now() });
});

export default router;
