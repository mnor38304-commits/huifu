import { Router, Response } from 'express';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types';

const router = Router();

// 获取公告列表
router.get('/', (req, res: Response<ApiResponse>) => {
  const { page = 1, pageSize = 10 } = req.query;
  
  const countResult = db.prepare('SELECT COUNT(*) as total FROM notices WHERE status = 1').get() as { total: number };
  
  const notices = db.prepare(`
    SELECT id, title, content, type, top, created_at
    FROM notices 
    WHERE status = 1
    ORDER BY top DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).all(Number(pageSize), (Number(page) - 1) * Number(pageSize));
  
  res.json({
    code: 0,
    message: 'success',
    data: {
      list: notices,
      total: countResult.total,
      page: Number(page),
      pageSize: Number(pageSize)
    },
    timestamp: Date.now()
  });
});

// 获取公告详情
router.get('/:id', (req, res: Response<ApiResponse>) => {
  const notice = db.prepare('SELECT * FROM notices WHERE id = ? AND status = 1').get(req.params.id);
  
  if (!notice) {
    return res.json({ code: 404, message: '公告不存在', timestamp: Date.now() });
  }
  
  res.json({ code: 0, message: 'success', data: notice, timestamp: Date.now() });
});

// 标记已读 (需登录)
router.post('/:id/read', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  res.json({ code: 0, message: '已标记已读', timestamp: Date.now() });
});

export default router;