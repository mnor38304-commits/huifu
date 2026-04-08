import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiResponse, JWTPayload } from '../types';

// 🔒 JWT 密钥必须通过环境变量传入，启动时强制检查
const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is required but not set.');
  console.error('   Please set JWT_SECRET in your .env file or environment.');
  console.error('   Example: JWT_SECRET=$(openssl rand -hex 32)');
  process.exit(1);
}

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

// ✅ FIX: httpOnly Cookie 方案 — Token 不再通过 JS 暴露给前端
// Cookie 名称（商户端）
export const USER_COOKIE_NAME = 'vcc_token';
// Cookie 安全配置
const COOKIE_OPTIONS = {
  httpOnly: true,       // JS 无法读写，防止 XSS 读取 token
  sameSite: 'lax' as const,  // 宽松模式：同站请求 + 顶层导航自动携带（推荐），兼顾 CSRF 保护与用户体验
  secure: process.env.NODE_ENV === 'production',  // 生产环境强制 HTTPS
  maxAge: 2 * 60 * 60 * 1000, // 2小时，与 token 有效期一致
};

/**
 * 将 JWT token 以 httpOnly Cookie 形式写入响应
 * @param res  Express 响应对象
 * @param token  JWT token 字符串
 * @param cookieName  Cookie 名称
 */
export function setAuthCookie(res: Response, token: string, cookieName = USER_COOKIE_NAME) {
  res.cookie(cookieName, token, COOKIE_OPTIONS);
}

/**
 * 清除 auth Cookie
 * @param res  Express 响应对象
 * @param cookieName  Cookie 名称
 */
export function clearAuthCookie(res: Response, cookieName = USER_COOKIE_NAME) {
  res.clearCookie(cookieName, { ...COOKIE_OPTIONS, maxAge: 0 });
}

/**
 * 统一 Token 提取函数 — 优先从 httpOnly Cookie 读取，兜底 Authorization Header
 * Cookie 优先：即使前端 axios 意外配置了 Authorization Header，
 * Cookie 始终存在且无法被 XSS 读取，是更安全的来源
 */
function extractToken(req: Request): string | null {
  // 优先：从 httpOnly Cookie 读取（商户端 vcc_token / 管理员 admin_token）
  const cookies = req.cookies as Record<string, string | undefined>;
  for (const name of [USER_COOKIE_NAME, 'admin_token']) {
    if (cookies[name]) return cookies[name];
  }
  // 兜底：Authorization Header（兼容旧版客户端）
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    const response: ApiResponse = {
      code: 401,
      message: '未登录或登录已过期',
      timestamp: Date.now()
    };
    return res.status(401).json(response);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as JWTPayload;
    req.user = decoded;
    next();
  } catch (error) {
    const response: ApiResponse = {
      code: 401,
      message: 'Token无效或已过期',
      timestamp: Date.now()
    };
    return res.status(401).json(response);
  }
}

// 导出密钥供其他模块使用（需确保密钥已通过上述检查）
export { JWT_SECRET };

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}

