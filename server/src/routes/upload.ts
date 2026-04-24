import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types';

const router = Router();

// 上传文件大小限制：5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// 允许的文件类型
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

/**
 * 简易 multipart/form-data 解析（无 multer 依赖）
 * 依赖 Express 4.x 内置的 busboy，但更简单的方式是用原生 req 读取
 * 这里用 multer-free 方案：前端发 base64，后端解码存储
 * 
 * 实际方案：接收 base64 字符串，解码后存到 uploads/ 目录
 */
router.post('/image', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    const { base64, filename: originalName } = req.body;

    if (!base64 || typeof base64 !== 'string') {
      return res.json({ code: 400, message: '请提供图片数据', timestamp: Date.now() });
    }

    // 提取 base64 数据部分（去掉 data:image/xxx;base64, 前缀）
    const matches = base64.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.json({ code: 400, message: '图片格式不正确，请上传 JPG/PNG/WebP 格式的图片', timestamp: Date.now() });
    }

    const ext = `.${matches[1].toLowerCase()}`;
    const data = matches[2];

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return res.json({ code: 400, message: `不支持的图片格式 ${ext}，请上传 JPG/PNG/WebP 格式`, timestamp: Date.now() });
    }

    // 检查文件大小（base64 解码后约为原大小的 3/4）
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length > MAX_FILE_SIZE) {
      return res.json({ code: 400, message: '图片大小不能超过 5MB', timestamp: Date.now() });
    }

    // 按日期分目录存储：uploads/kyc/2026-04/
    const dateDir = new Date().toISOString().slice(0, 7).replace('-', '/');
    const subDir = path.resolve(process.cwd(), 'uploads', 'kyc', dateDir);

    if (!fs.existsSync(subDir)) {
      fs.mkdirSync(subDir, { recursive: true });
    }

    // 生成唯一文件名
    const hash = crypto.randomBytes(8).toString('hex');
    const filename = `${Date.now()}_${hash}${ext}`;
    const filepath = path.join(subDir, filename);

    fs.writeFileSync(filepath, buffer);

    // 返回可访问的 URL 路径
    const url = `/uploads/kyc/${dateDir}/${filename}`;

    res.json({
      code: 0,
      message: '上传成功',
      data: { url, filename },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error('[Upload] failed:', err);
    res.status(500).json({ code: 500, message: err?.message || '上传失败', timestamp: Date.now() });
  }
});

export default router;
