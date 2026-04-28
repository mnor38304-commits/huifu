import { Router } from 'express';
import db from '../db';
import { adminAuth, AdminRequest } from './admin-auth';

const router = Router();

// ── 脱敏辅助函数 ─────────────────────────────────────────────
function maskString(s: string | null | undefined, keepFront = 8, keepBack = 4): string {
  if (!s) return '';
  if (s.length <= keepFront + keepBack) return s.slice(0, keepFront) + '***';
  return s.slice(0, keepFront) + '*'.repeat(s.length - keepFront - keepBack) + s.slice(-keepBack);
}

// ── 1. UQPay 充值订单列表 ────────────────────────────────────
router.get('/recharge-orders', adminAuth, (req, res) => {
  try {
    const {
      page = 1, pageSize = 20,
      status, user_id, card_id, order_id,
      date_from, date_to, keyword
    } = req.query as Record<string, string>;

    let sql = `SELECT * FROM uqpay_recharge_orders WHERE 1=1`;
    const params: any[] = [];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (user_id) {
      sql += ` AND user_id = ?`;
      params.push(Number(user_id));
    }
    if (card_id) {
      sql += ` AND card_id = ?`;
      params.push(Number(card_id));
    }
    if (order_id) {
      sql += ` AND id = ?`;
      params.push(Number(order_id));
    }
    if (date_from) {
      sql += ` AND created_at >= ?`;
      params.push(date_from);
    }
    if (date_to) {
      sql += ` AND created_at <= ?`;
      params.push(date_to + ' 23:59:59');
    }
    if (keyword) {
      sql += ` AND (card_order_id LIKE ? OR unique_request_id LIKE ? OR error_message LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    // 统计总数
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as c');
    const total = (db.prepare(countSql).get(...params) as any).c;

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

    const list = db.prepare(sql).all(...params) as any[];

    // 脱敏处理
    const maskedList = list.map((row: any) => ({
      ...row,
      card_order_id: maskString(row.card_order_id, 8, 4),
      unique_request_id: maskString(row.unique_request_id, 8, 4),
      uqpay_response: undefined,  // 不输出原始响应
    }));

    res.json({
      code: 0,
      data: { list: maskedList, total, page: Number(page), pageSize: Number(pageSize) },
      timestamp: Date.now()
    });
  } catch (err: any) {
    console.error('[Admin UQPay] recharge-orders error:', err.message);
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

// ── 2. 对账告警列表 ──────────────────────────────────────────
router.get('/reconcile-alerts', adminAuth, (req, res) => {
  try {
    const {
      page = 1, pageSize = 20,
      severity, alert_type, status, order_id,
      date_from, date_to
    } = req.query as Record<string, string>;

    let sql = `SELECT * FROM reconcile_alerts WHERE 1=1`;
    const params: any[] = [];

    if (severity) {
      sql += ` AND severity = ?`;
      params.push(severity);
    }
    if (alert_type) {
      sql += ` AND alert_type = ?`;
      params.push(alert_type);
    }
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (order_id) {
      sql += ` AND order_id = ?`;
      params.push(Number(order_id));
    }
    if (date_from) {
      sql += ` AND created_at >= ?`;
      params.push(date_from);
    }
    if (date_to) {
      sql += ` AND created_at <= ?`;
      params.push(date_to + ' 23:59:59');
    }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as c');
    const total = (db.prepare(countSql).get(...params) as any).c;

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

    const list = db.prepare(sql).all(...params);

    res.json({
      code: 0,
      data: { list, total, page: Number(page), pageSize: Number(pageSize) },
      timestamp: Date.now()
    });
  } catch (err: any) {
    console.error('[Admin UQPay] reconcile-alerts error:', err.message);
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

// ── 3. Webhook 事件列表 ──────────────────────────────────────
router.get('/webhook-events', adminAuth, (req, res) => {
  try {
    const {
      page = 1, pageSize = 20,
      event_type, processed_status, date_from, date_to
    } = req.query as Record<string, string>;

    let sql = `SELECT id, event_id, event_type, source_id, processed_status, error_message, created_at, processed_at FROM uqpay_webhook_events WHERE 1=1`;
    const params: any[] = [];

    if (event_type) {
      sql += ` AND event_type = ?`;
      params.push(event_type);
    }
    if (processed_status) {
      sql += ` AND processed_status = ?`;
      params.push(processed_status);
    }
    if (date_from) {
      sql += ` AND created_at >= ?`;
      params.push(date_from);
    }
    if (date_to) {
      sql += ` AND created_at <= ?`;
      params.push(date_to + ' 23:59:59');
    }

    const countSql = sql.replace(/SELECT id.*?FROM/, 'SELECT COUNT(*) as c FROM');
    const total = (db.prepare(countSql).get(...params) as any).c;

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

    const list = db.prepare(sql).all(...params);

    res.json({
      code: 0,
      data: { list, total, page: Number(page), pageSize: Number(pageSize) },
      timestamp: Date.now()
    });
  } catch (err: any) {
    console.error('[Admin UQPay] webhook-events error:', err.message);
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

export default router;
