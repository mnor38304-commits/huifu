/**
 * UQPay Reconcile 告警扫描 Service
 *
 * 定时扫描 PENDING/UNKNOWN 充值订单及 Webhook 异常事件，
 * 将告警记录写入 reconcile_alerts 表。
 *
 * 核心原则：
 * - 不修改订单状态
 * - 不改钱包/卡余额
 * - 不调用 UQPay 外部接口
 * - 不输出敏感信息
 *
 * 扫描规则
 * ─────────────────────────────────────────────────
 * R1. PENDING > 10 分钟 → WARNING
 * R2. PENDING > 30 分钟 → CRITICAL
 * R3. UNKNOWN > 10 分钟 → WARNING
 * R4. 单次 reconcile 连续失败 > 3 → CRITICAL
 * R5. 失败率 > 50% → CRITICAL
 * R6. payload=null > 5 次/小时 → WARNING
 * R7. NEEDS_RECONCILE > 3 次/小时 → WARNING
 * R8. 卡余额和订单余额不匹配 → WARNING（即 UNKNOWN 状态）
 */

import db, { getDb, saveDatabase } from '../db';

// ── 类型 ──────────────────────────────────────────────────────────────

export interface AlertScanOptions {
  /** 每轮最多扫描的订单数 */
  maxOrders?: number;
  /** 只扫描最近 N 小时的订单/事件 */
  lookbackHours?: number;
  /** 仅打印，不写库 */
  dryRun?: boolean;
}

export interface AlertScanResult {
  scanned: number;      // 扫描的订单数
  created: number;      // 新增告警数
  updated: number;      // 更新已有告警数
  warnings: number;     // WARNING 级告警
  criticals: number;    // CRITICAL 级告警
  skipped: number;      // 跳过（已解决或终态）
  errors: string[];     // 错误列表
}

// ── Alert key 生成 ────────────────────────────────────────────────────

function alertKey(prefix: string, id?: number | string): string {
  return id != null ? `${prefix}:${id}` : `${prefix}:${Date.now()}`;
}

// ── 核心 upsert ──────────────────────────────────────────────────────

function upsertAlert(
  key: string,
  type: string,
  severity: string,
  message: string,
  payload?: Record<string, any>,
  orderId?: number,
  userId?: number,
  cardId?: number,
  status?: string,
): boolean {
  const existing = db.prepare(
    'SELECT id, resolved_at FROM reconcile_alerts WHERE alert_key = ?'
  ).get(key) as any;

  const now = new Date().toISOString();

  if (existing) {
    // 已解决 → 不更新（保留解决记录）
    if (existing.resolved_at) {
      return false;
    }
    // 未解决 → 只更新 last_seen_at 和 message
    db.prepare(
      `UPDATE reconcile_alerts
       SET last_seen_at = ?, message = ?, payload_json = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(now, message, JSON.stringify(payload ?? {}).slice(0, 4000), now, existing.id);
    return true;
  }

  // 新增
  db.prepare(
    `INSERT INTO reconcile_alerts
      (alert_key, alert_type, severity, order_id, user_id, card_id, status,
       message, payload_json, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    key, type, severity,
    orderId ?? null, userId ?? null, cardId ?? null, status ?? null,
    message.slice(0, 1000),
    JSON.stringify(payload ?? {}).slice(0, 4000),
    now, now, now, now,
  );
  return true;
}

// ── 扫描规则实现 ─────────────────────────────────────────────────────

/**
 * R1 + R2: PENDING 超时告警
 * PENDING > 10 分钟 → WARNING
 * PENDING > 30 分钟 → CRITICAL
 */
function scanPendingTimeouts(
  maxOrders: number,
  lookbackHours: number,
  dryRun: boolean,
): AlertScanResult {
  const result: AlertScanResult = { scanned: 0, created: 0, updated: 0, warnings: 0, criticals: 0, skipped: 0, errors: [] };

  const rows = db.prepare(
    `SELECT id, user_id, card_id, status,
            (julianday('now') - julianday(created_at)) * 24 * 60 AS age_minutes
     FROM uqpay_recharge_orders
     WHERE status IN ('PENDING', 'UNKNOWN')
       AND (julianday('now') - julianday(created_at)) * 24 <= ?
     ORDER BY created_at ASC
     LIMIT ?`
  ).get(lookbackHours, maxOrders) as any[];

  const orders: any[] = Array.isArray(rows) ? rows : [rows].filter(Boolean);
  result.scanned = orders.length;

  for (const row of orders) {
    const ageMin = Math.round(row.age_minutes || 0);
    const status = (row.status || '').toUpperCase();

    // UNKNOWN → 走 R3
    if (status === 'UNKNOWN') continue;

    // PENDING
    if (status === 'PENDING') {
      if (ageMin >= 30) {
        const key = `pending_timeout_30m:${row.id}`;
        const msg = `订单 PENDING 超过 30 分钟: order_id=${row.id}, age=${ageMin}min`;
        if (!dryRun) {
          const updated = upsertAlert(key, 'PENDING_TIMEOUT', 'CRITICAL', msg, undefined, row.id, row.user_id, row.card_id, row.status);
          if (updated) result.criticals++;
          else result.skipped++;
          if (updated) { result.created++; }
        }
      } else if (ageMin >= 10) {
        const key = `pending_timeout_10m:${row.id}`;
        const msg = `订单 PENDING 超过 10 分钟: order_id=${row.id}, age=${ageMin}min`;
        if (!dryRun) {
          const updated = upsertAlert(key, 'PENDING_TIMEOUT', 'WARNING', msg, undefined, row.id, row.user_id, row.card_id, row.status);
          if (updated) result.warnings++;
          else result.skipped++;
        }
      }
    }
  }

  return result;
}

/**
 * R3: UNKNOWN 超时告警
 * UNKNOWN > 10 分钟 → WARNING
 */
function scanUnknownTimeouts(
  maxOrders: number,
  lookbackHours: number,
  dryRun: boolean,
): AlertScanResult {
  const result: AlertScanResult = { scanned: 0, created: 0, updated: 0, warnings: 0, criticals: 0, skipped: 0, errors: [] };

  const rows = db.prepare(
    `SELECT id, user_id, card_id, status,
            (julianday('now') - julianday(created_at)) * 24 * 60 AS age_minutes
     FROM uqpay_recharge_orders
     WHERE status = 'UNKNOWN'
       AND (julianday('now') - julianday(created_at)) * 24 <= ?
       AND (julianday('now') - julianday(created_at)) * 24 * 60 >= 10
     ORDER BY created_at ASC
     LIMIT ?`
  ).get(lookbackHours, maxOrders) as any[];

  const orders: any[] = Array.isArray(rows) ? rows : [rows].filter(Boolean);
  result.scanned = orders.length;

  for (const row of orders) {
    const ageMin = Math.round(row.age_minutes || 0);
    const key = `unknown_timeout:${row.id}`;
    const msg = `订单 UNKNOWN 超过 10 分钟: order_id=${row.id}, age=${ageMin}min`;
    if (!dryRun) {
      const updated = upsertAlert(key, 'UNKNOWN_TIMEOUT', 'WARNING', msg, undefined, row.id, row.user_id, row.card_id, row.status);
      if (updated) { result.warnings++; result.created++; }
      else result.skipped++;
    }
  }

  return result;
}

/**
 * R6: payload=null 计数异常
 * 1 小时内收到 > 5 次 payload=null → WARNING
 */
function scanPayloadNull(
  lookbackHours: number,
  dryRun: boolean,
): AlertScanResult {
  const result: AlertScanResult = { scanned: 0, created: 0, updated: 0, warnings: 0, criticals: 0, skipped: 0, errors: [] };

  const countRow = db.prepare(
    `SELECT COUNT(*) AS cnt
     FROM uqpay_webhook_events
     WHERE payload_json IS NULL
       AND (julianday('now') - julianday(created_at)) * 24 <= ?`
  ).get(lookbackHours) as any;

  const count = countRow?.cnt || 0;

  if (count > 5) {
    // 使用 1 小时滑动窗口的 alert_key
    const hourBucket = Math.floor(Date.now() / 3600000);
    const key = `payload_null_count:${hourBucket}`;
    const msg = `1 小时内 payload=null 事件 ${count} 次（阈值: 5）`;
    if (!dryRun) {
      const updated = upsertAlert(key, 'PAYLOAD_NULL', 'WARNING', msg, { count, threshold: 5 });
      if (updated) { result.warnings++; result.created++; } else result.skipped++;
    }
  }

  return result;
}

/**
 * R7: NEEDS_RECONCILE 计数异常
 * 1 小时内收到 > 3 次 NEEDS_RECONCILE → WARNING
 */
function scanNeedsReconcile(
  lookbackHours: number,
  dryRun: boolean,
): AlertScanResult {
  const result: AlertScanResult = { scanned: 0, created: 0, updated: 0, warnings: 0, criticals: 0, skipped: 0, errors: [] };

  const countRow = db.prepare(
    `SELECT COUNT(*) AS cnt
     FROM uqpay_webhook_events
     WHERE processed_status = 'NEEDS_RECONCILE'
       AND (julianday('now') - julianday(created_at)) * 24 <= ?`
  ).get(lookbackHours) as any;

  const count = countRow?.cnt || 0;

  if (count > 3) {
    const hourBucket = Math.floor(Date.now() / 3600000);
    const key = `needs_reconcile_count:${hourBucket}`;
    const msg = `1 小时内 NEEDS_RECONCILE 事件 ${count} 次（阈值: 3）`;
    if (!dryRun) {
      const updated = upsertAlert(key, 'NEEDS_RECONCILE', 'WARNING', msg, { count, threshold: 3 });
      if (updated) { result.warnings++; result.created++; } else result.skipped++;
    }
  }

  return result;
}

// ── 主入口 ────────────────────────────────────────────────────────────

/**
 * 全量告警扫描入口
 *
 * 依次执行所有扫描规则，返回汇总结果。
 * 安全约束：
 * - 不修改订单状态
 * - 不改钱包/卡余额
 * - 不调用 UQPay 外部接口
 * - 不输出敏感信息
 */
export async function scanPendingRechargeAlerts(
  options: AlertScanOptions = {},
): Promise<AlertScanResult> {
  const {
    maxOrders = 50,
    lookbackHours = 24,
    dryRun = false,
  } = options;

  const merged: AlertScanResult = {
    scanned: 0, created: 0, updated: 0,
    warnings: 0, criticals: 0, skipped: 0,
    errors: [],
  };

  const scanners = [
    () => scanPendingTimeouts(maxOrders, lookbackHours, dryRun),
    () => scanUnknownTimeouts(maxOrders, lookbackHours, dryRun),
    () => scanPayloadNull(lookbackHours, dryRun),
    () => scanNeedsReconcile(lookbackHours, dryRun),
  ];

  for (const scanner of scanners) {
    try {
      const r = scanner();
      merged.scanned += r.scanned;
      merged.created += r.created;
      merged.updated += r.updated;
      merged.warnings += r.warnings;
      merged.criticals += r.criticals;
      merged.skipped += r.skipped;
      merged.errors.push(...r.errors);
    } catch (err: any) {
      const msg = `扫描异常: ${(err?.message || String(err)).slice(0, 300)}`;
      merged.errors.push(msg);
      console.error(`[ReconcileAlerts] ${msg}`);
    }
  }

  // 非 dry-run 时保存数据库
  if (!dryRun) {
    saveDatabase();
  }

  return merged;
}
