/**
 * UQPay Webhook 事件接收路由骨架
 *
 * 路径: POST /api/v1/webhook/uqpay/notify
 *
 * 安全要求:
 * - 不保存 PAN/CVV 等敏感卡号数据
 * - 不输出 token/clientId/apiKey
 * - 不输出完整 payload 中的敏感字段
 * - event_id 幂等：重复事件不重复写入，直接返回成功
 *
 * 本轮只做基础设施，不做资金入账/出账处理。
 *
 * 文档参考: https://docs.uqpay.com/docs/webhooks
 */

import { Router } from 'express';
import db, { getDb, saveDatabase } from '../db';

const router = Router();

// 已知 UQPay Webhook 敏感字段列表（不写入日志/payload_json）
const SENSITIVE_FIELDS = new Set([
  'card_number', 'pan', 'cvv', 'cvv2', 'cvc',
  'expiry_month', 'expiry_year',
  'password', 'secret', 'token',
  'x-auth-token', 'authorization',
  'api_key', 'apiSecret', 'api_secret',
  'x-client-id', 'x-api-key',
]);

/**
 * 深度过滤 payload 中敏感字段，返回安全副本
 */
function sanitizePayload(obj: any, depth = 0): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (depth > 10) return '[MAX_DEPTH]'; // 防止嵌套过深

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizePayload(item, depth + 1));
  }

  const sanitized: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizePayload(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * 检查 event_id 是否已处理（幂等）
 */
function isEventProcessed(eventId: string): boolean {
  const database = getDb();
  const stmt = database.prepare('SELECT id FROM uqpay_webhook_events WHERE event_id = ?');
  stmt.bind([eventId]);
  const processed = stmt.step();
  stmt.free();
  return processed;
}

/**
 * POST /api/v1/webhook/uqpay/notify
 *
 * 接收 UQPay Webhook 回调，幂等写入 uqpay_webhook_events 表。
 *
 * 预期 body 字段（来自 UQPay 文档）:
 *   event_id    - 事件唯一 ID（幂等键）
 *   event_type  - 事件类型，如 card.recharge / card.withdraw / card.status.change
 *   source_id   - 来源 ID（如 card_id）
 *   payload     - 事件数据（敏感字段自动过滤）
 *   timestamp   - 事件时间戳
 *
 * 返回:
 *   { code: 0, message: 'SUCCESS' }
 *   或
 *   { code: 409, message: 'DUPLICATE_EVENT' }  ← 已处理过的重复事件
 */
router.post('/notify', async (req, res) => {
  const { event_id, event_type, source_id, payload, timestamp } = req.body || {};

  // ── 基础校验 ────────────────────────────────────────────────
  if (!event_id || typeof event_id !== 'string') {
    return res.json({
      code: 400,
      message: 'Missing or invalid event_id',
      timestamp: Date.now(),
    });
  }

  // ── 幂等检查：event_id 已存在则直接返回成功 ───────────────────
  if (isEventProcessed(event_id)) {
    console.log(`[UQPay Webhook] 重复事件已跳过: event_id=${event_id}`);
    return res.json({
      code: 0,
      message: 'SUCCESS', // 仍然返回成功，告诉 UQPay 不要重试
      timestamp: Date.now(),
    });
  }

  // ── 安全过滤 payload ─────────────────────────────────────────
  const sanitizedPayload = sanitizePayload(payload);

  // ── 写入数据库（直接调用 database.prepare().run()，与 uqpay.ts 模式完全一致） ──
  try {
    const database = getDb();
    const stmt = database.prepare(`
      INSERT INTO uqpay_webhook_events
        (event_id, event_type, source_id, payload_json, processed_status)
      VALUES (?, ?, ?, ?, 'PENDING')
    `);
    stmt.run([
      String(event_id),
      String(event_type || ''),
      String(source_id || ''),
      JSON.stringify(sanitizedPayload),
    ]);
    stmt.free();
    saveDatabase();
  } catch (err: any) {
    // 幂等：UNIQUE 冲突时忽略并返回成功
    const msg = err && (err.message || String(err));
    if (msg && (msg.includes('UNIQUE') || msg.includes('constraint'))) {
      console.log(`[UQPay Webhook] 幂等跳过: event_id=${event_id}`);
      return res.json({ code: 0, message: 'SUCCESS', timestamp: Date.now() });
    }
    // 记录真实错误以便调试
    console.error('[UQPay Webhook] 写入失败:', msg, 'event_id=' + event_id);
    return res.json({ code: 500, message: 'Failed to record event', timestamp: Date.now() });
  }

  console.log(
    `[UQPay Webhook] 事件记录: event_id=${event_id} event_type=${event_type} source_id=${source_id}`
  );

  // TODO(PR-4): 事件处理调度
  //   - 根据 event_type 分发到对应处理器
  //   - card.recharge  → 充值成功：更新 cards.balance + uqpay_recharge_orders
  //   - card.withdraw  → 提现回调：更新本地卡余额
  //   - card.status.*  → 卡状态变更同步
  //   - payment.captured → 消费扣款同步

  return res.json({
    code: 0,
    message: 'SUCCESS',
    timestamp: Date.now(),
  });
});

/**
 * GET /api/v1/webhook/uqpay/events
 *
 * 管理端查询 UQPay Webhook 事件记录（分页）
 *
 * 查询参数:
 *   page        - 页码（默认 1）
 *   pageSize    - 每页条数（默认 20）
 *   event_type  - 按事件类型筛选
 *   status      - 按处理状态筛选（PENDING/PROCESSING/SUCCESS/FAILED）
 */
router.get('/events', (req, res) => {
  const { page = '1', pageSize = '20', event_type, status } = req.query;
  const pageNum = Math.max(1, parseInt(String(page), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(pageSize), 10)));
  const offset = (pageNum - 1) * limit;

  let where = '1=1';
  const params: any[] = [];

  if (event_type) {
    where += ' AND event_type = ?';
    params.push(String(event_type));
  }
  if (status) {
    where += ' AND processed_status = ?';
    params.push(String(status));
  }

  const database = getDb();

  const totalStmt = database.prepare(`SELECT COUNT(*) as total FROM uqpay_webhook_events WHERE ${where}`);
  totalStmt.bind(params.length > 0 ? params : []);
  totalStmt.step();
  const total = totalStmt.getAsObject().total as number;
  totalStmt.free();

  const listStmt = database.prepare(`
    SELECT id, event_id, event_type, source_id, processed_status,
           error_message, created_at, processed_at
    FROM uqpay_webhook_events
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  listStmt.bind([...params, limit, offset]);
  const rows: any[] = [];
  while (listStmt.step()) rows.push(listStmt.getAsObject());
  listStmt.free();

  res.json({
    code: 0,
    message: 'success',
    data: {
      list: rows,
      pagination: { page: pageNum, pageSize: limit, total },
    },
    timestamp: Date.now(),
  });
});

export default router;
