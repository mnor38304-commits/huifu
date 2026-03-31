import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiResponse, JWTPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'vcc-secret-key';

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const response: ApiResponse = {
      code: 401,
      message: '未登录或登录已过期',
      timestamp: Date.now()
    };
    return res.status(401).json(response);
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
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

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}
