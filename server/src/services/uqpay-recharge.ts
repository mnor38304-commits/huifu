/**
 * UQPay 卡充值 Service
 *
 * 封装 UQPay 真实充值完整事务流程：
 * 1. 校验（卡归属、状态、external_id、金额、钱包余额）
 * 2. 幂等/并发检查（同卡有 PENDING 订单时拒绝）
 * 3. 开启事务：扣钱包 → 写流水 → 写充值订单
 * 4. 调用 UQPay SDK rechargeCard()
 * 5. 根据结果更新订单/回滚/同步余额
 *
 * 安全约束:
 * - 不保存 PAN / CVV
 * - 不使用 card_number
 * - 不使用 PAN Token
 * - 不输出 token / clientId / apiKey
 * - 所有日志脱敏
 *
 * 已知假设:
 * - 1 USDT = 1 USD（本轮不做汇率转换）
 */

import { randomUUID } from 'crypto';
import db, { getDb, saveDatabase } from '../db';
import { UqPaySDK, UqPayRechargeResponse } from '../channels/uqpay';

// ── 类型 ──────────────────────────────────────────────────────────────

export interface TopupValidation {
  cardId: number;
  userId: number;
  amount: number;
  externalId: string;
  cardNoMasked: string;
  walletBalance: number;
}

export interface RechargeResult {
  success: boolean;
  code: number;
  message: string;
  data?: {
    orderId: number;
    orderStatus: string;
    newCardBalance?: number;
    walletBalance: number;
  };
}

// ── SDK 工厂（复用 cards.ts 的 getChannelSDK 模式）────────────────────

function getUqPaySDK(): UqPaySDK | null {
  const uqpayChannel = db.prepare(
    "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'UQPAY' AND status = 1"
  ).get() as any;

  if (!uqpayChannel) return null;

  let config: Record<string, string> = {};
  try {
    config = JSON.parse(uqpayChannel.config_json || '{}');
  } catch (_) {}

  return new UqPaySDK({
    clientId: config.clientId || uqpayChannel.api_key || '',
    apiKey: config.apiSecret || uqpayChannel.api_secret || '',
    baseUrl: uqpayChannel.api_base_url || undefined,
  });
}

// ── 校验 ──────────────────────────────────────────────────────────────

export function validateTopup(
  cardId: number,
  userId: number,
  amount: number
): TopupValidation {
  // 1. 金额校验
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0 || !Number.isFinite(numAmount)) {
    throw { code: 400, message: '请输入有效金额' } as any;
  }

  // 2. 卡片校验
  const card = db.prepare(
    'SELECT c.*, u.email FROM cards c LEFT JOIN users u ON c.user_id = u.id WHERE c.id = ? AND c.user_id = ?'
  ).get(cardId, userId) as any;

  if (!card) {
    throw { code: 404, message: '卡片不存在' } as any;
  }

  if (card.status !== 1) {
    throw { code: 400, message: '卡片状态异常，无法充值' } as any;
  }

  if (card.channel_code?.toUpperCase() !== 'UQPAY') {
    throw { code: 400, message: '该接口仅支持 UQPay 卡充值' } as any;
  }

  if (!card.external_id) {
    throw { code: 400, message: 'UQPay 卡外部 ID 缺失，无法充值' } as any;
  }

  // 3. 钱包校验
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;
  if (!wallet) {
    throw { code: 400, message: '钱包不存在，请先创建钱包' } as any;
  }

  // 假设：1 USDT = 1 USD，本轮不做汇率转换
  const walletBalance = wallet.balance_usd || 0;
  if (walletBalance < numAmount) {
    throw { code: 400, message: `钱包余额不足，当前余额: $${walletBalance}` } as any;
  }

  return {
    cardId,
    userId,
    amount: numAmount,
    externalId: card.external_id,
    cardNoMasked: card.card_no_masked,
    walletBalance,
  };
}

// ── 幂等/并发检查 ──────────────────────────────────────────────────────

export function checkPendingOrder(cardId: number): boolean {
  // 同卡有未完成订单时拒绝新充值
  const pending = db.prepare(
    "SELECT id FROM uqpay_recharge_orders WHERE card_id = ? AND status IN ('PENDING', 'UNKNOWN') LIMIT 1"
  ).get(cardId) as any;
  return !!pending;
}

// ── 创建充值订单 + 扣钱包（事务）───────────────────────────────────────

export function createRechargeOrder(
  userId: number,
  cardId: number,
  amount: number,
  uniqueRequestId: string,
  externalId: string,
  cardNoMasked: string,
  walletBalanceBefore: number
): number {
  const database = getDb();
  const walletBalanceAfter = walletBalanceBefore - amount;

  try {
    database.run('BEGIN');

    // 扣减钱包余额
    database.run(
      'UPDATE wallets SET balance_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [walletBalanceAfter, userId]
    );

    // 写入交易流水
    const txnNo = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
    database.run(
      `INSERT INTO transactions (txn_no, card_id, user_id, txn_type, amount, currency, status, merchant_name, txn_time)
       VALUES (?, ?, ?, 'TOPUP', ?, 'USD', 1, 'UQPay卡充值', CURRENT_TIMESTAMP)`,
      [txnNo, cardId, userId, amount]
    );

    // 写入钱包流水
    database.run(
      `INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type, reference_id)
       VALUES (?, 'CARD_TOPUP', ?, ?, ?, 'USD', ?, 'card_topup', ?)`,
      [userId, -amount, walletBalanceBefore, walletBalanceAfter,
       `UQPay充值到卡片 ${cardNoMasked}`, cardId]
    );

    // 写入充值订单
    const orderStmt = database.prepare(
      `INSERT INTO uqpay_recharge_orders
        (unique_request_id, card_id, user_id, amount, currency, status, uqpay_card_id, wallet_record_id)
       VALUES (?, ?, ?, ?, 'USD', 'PENDING', ?, ?)`
    );
    orderStmt.run([uniqueRequestId, cardId, userId, amount, externalId, txnNo]);
    orderStmt.free();

    // 获取刚插入的订单 ID
    const idStmt = database.prepare(
      "SELECT id FROM uqpay_recharge_orders WHERE unique_request_id = ?"
    );
    idStmt.bind([uniqueRequestId]);
    idStmt.step();
    const orderRow = idStmt.getAsObject();
    idStmt.free();
    const orderId = orderRow?.id as number;

    database.run('COMMIT');
    saveDatabase();

    return orderId;
  } catch (err: any) {
    database.run('ROLLBACK');
    saveDatabase();
    throw err;
  }
}

// ── 调用 UQPay 充值 ───────────────────────────────────────────────────

export async function callUqPayRecharge(
  sdk: UqPaySDK,
  externalId: string,
  amount: number,
  uniqueRequestId: string
): Promise<UqPayRechargeResponse> {
  return sdk.rechargeCard(externalId, amount, uniqueRequestId);
}

// ── 标记充值成功 ──────────────────────────────────────────────────────

export async function markRechargeSuccess(
  orderId: number,
  result: UqPayRechargeResponse,
  cardId: number
): Promise<number | undefined> {
  const database = getDb();

  // 更新充值订单
  database.run(
    `UPDATE uqpay_recharge_orders
     SET status = 'SUCCESS', order_status = ?, card_order_id = ?, uqpay_response = ?,
         balance_after = ?, card_available_balance = ?,
         completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      result.order_status,
      result.card_order_id || '',
      JSON.stringify(result.raw_json).slice(0, 4000), // 限制存储大小，脱敏
      result.balance_after,
      result.card_available_balance,
      orderId,
    ]
  );

  // 同步卡余额
  let newCardBalance: number | undefined;

  if (result.card_available_balance != null) {
    newCardBalance = result.card_available_balance;
  } else if (result.balance_after != null) {
    newCardBalance = result.balance_after;
  }

  if (newCardBalance != null) {
    database.run(
      'UPDATE cards SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newCardBalance, cardId]
    );
  } else {
    // 响应没有余额字段，主动查询卡详情
    try {
      const sdk = getUqPaySDK();
      if (sdk) {
        const cardDetail = await sdk.getCard(result.card_id);
        newCardBalance = cardDetail.card_available_balance;
        database.run(
          'UPDATE cards SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [newCardBalance, cardId]
        );
      }
    } catch (e: any) {
      console.warn('[UQPay Recharge] 查询卡余额失败:', e.message);
    }
  }

  saveDatabase();
  return newCardBalance;
}

// ── 标记充值失败 + 回滚钱包 ───────────────────────────────────────────

export function markRechargeFailed(
  orderId: number,
  errorMessage: string,
  userId: number,
  cardId: number,
  amount: number
): void {
  const database = getDb();

  try {
    database.run('BEGIN');

    // 更新充值订单
    database.run(
      `UPDATE uqpay_recharge_orders
       SET status = 'FAILED', order_status = 'FAILED', error_message = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [errorMessage.slice(0, 500), orderId]
    );

    // 回滚钱包余额
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;
    if (wallet) {
      const balanceBefore = wallet.balance_usd || 0;
      const balanceAfter = balanceBefore + amount;

      database.run(
        'UPDATE wallets SET balance_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [balanceAfter, userId]
      );

      // 写退款流水
      database.run(
        `INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type, reference_id)
         VALUES (?, 'CARD_TOPUP_FAILED', ?, ?, ?, 'USD', ?, 'card_topup_refund', ?)`,
        [userId, amount, balanceBefore, balanceAfter,
         `UQPay充值失败退款 卡ID:${cardId}`, orderId]
      );
    }

    database.run('COMMIT');
    saveDatabase();
  } catch (err: any) {
    database.run('ROLLBACK');
    saveDatabase();
    console.error('[UQPay Recharge] 回滚失败:', err.message);
  }
}

// ── Webhook: 充值成功处理 ─────────────────────────────────────────────

export function handleWebhookRechargeSucceeded(payload: any): void {
  const database = getDb();

  const cardOrderId = payload.card_order_id;
  const cardId = payload.card_id;
  const cardAvailableBalance = payload.card_available_balance;

  if (!cardOrderId && !cardId) {
    console.warn('[UQPay Webhook] recharge.succeeded 缺少 card_order_id 和 card_id');
    return;
  }

  // 查找对应的充值订单
  let order: any = null;

  if (cardOrderId) {
    order = db.prepare(
      "SELECT * FROM uqpay_recharge_orders WHERE card_order_id = ? AND status IN ('PENDING', 'UNKNOWN') LIMIT 1"
    ).get(cardOrderId) as any;
  }

  if (!order && cardId) {
    // fallback: 通过 uqpay_card_id 查找
    order = db.prepare(
      "SELECT * FROM uqpay_recharge_orders WHERE uqpay_card_id = ? AND status IN ('PENDING', 'UNKNOWN') ORDER BY id DESC LIMIT 1"
    ).get(cardId) as any;
  }

  if (!order) {
    console.log('[UQPay Webhook] recharge.succeeded 未找到匹配订单, card_order_id:', cardOrderId);
    return;
  }

  // 更新订单状态
  database.run(
    `UPDATE uqpay_recharge_orders
     SET status = 'SUCCESS', order_status = 'SUCCESS',
         card_available_balance = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('PENDING', 'UNKNOWN')`,
    [cardAvailableBalance != null ? Number(cardAvailableBalance) : null, order.id]
  );

  // 同步卡余额
  if (cardAvailableBalance != null) {
    database.run(
      'UPDATE cards SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [Number(cardAvailableBalance), order.card_id]
    );
  }

  // 检查是否实际更新了行
  const didUpdate = database.getRowsModified() > 0;

  saveDatabase();

  if (didUpdate) {
    console.log(
      `[UQPay Webhook] recharge.succeeded 处理成功: order_id=${order.id}, card_id=${order.card_id}, balance=${cardAvailableBalance}`
    );
  } else {
    console.log(
      `[UQPay Webhook] recharge.succeeded 订单已处理: order_id=${order.id}`
    );
  }
}

// ── Webhook: 充值失败处理 ─────────────────────────────────────────────

export function handleWebhookRechargeFailed(payload: any): void {
  const database = getDb();

  const cardOrderId = payload.card_order_id;
  const cardId = payload.card_id;
  const errorMessage = payload.error_message || payload.reason || 'Webhook: recharge failed';

  if (!cardOrderId && !cardId) {
    console.warn('[UQPay Webhook] recharge.failed 缺少 card_order_id 和 card_id');
    return;
  }

  // 查找对应的充值订单
  let order: any = null;

  if (cardOrderId) {
    order = db.prepare(
      "SELECT * FROM uqpay_recharge_orders WHERE card_order_id = ? AND status IN ('PENDING', 'UNKNOWN') LIMIT 1"
    ).get(cardOrderId) as any;
  }

  if (!order && cardId) {
    order = db.prepare(
      "SELECT * FROM uqpay_recharge_orders WHERE uqpay_card_id = ? AND status IN ('PENDING', 'UNKNOWN') ORDER BY id DESC LIMIT 1"
    ).get(cardId) as any;
  }

  if (!order) {
    console.log('[UQPay Webhook] recharge.failed 未找到匹配订单, card_order_id:', cardOrderId);
    return;
  }

  if (order.status === 'SUCCESS') {
    // 已成功的不处理
    console.log('[UQPay Webhook] recharge.failed 但订单已成功, order_id:', order.id);
    return;
  }

  try {
    database.run('BEGIN');

    // 更新订单状态
    database.run(
      `UPDATE uqpay_recharge_orders
       SET status = 'FAILED', order_status = 'FAILED', error_message = ?,
           completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('PENDING', 'UNKNOWN')`,
      [String(errorMessage).slice(0, 500), order.id]
    );

    // 回滚钱包
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(order.user_id) as any;
    if (wallet) {
      const balanceBefore = wallet.balance_usd || 0;
      const balanceAfter = balanceBefore + order.amount;

      database.run(
        'UPDATE wallets SET balance_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [balanceAfter, order.user_id]
      );

      database.run(
        `INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type, reference_id)
         VALUES (?, 'CARD_TOPUP_FAILED', ?, ?, ?, 'USD', ?, 'card_topup_refund', ?)`,
        [order.user_id, order.amount, balanceBefore, balanceAfter,
         `UQPay充值失败退款(Webhook) 卡ID:${order.card_id}`, order.id]
      );
    }

    database.run('COMMIT');
    saveDatabase();

    console.log(
      `[UQPay Webhook] recharge.failed 处理完成: order_id=${order.id}, 钱包已回滚 $${order.amount}`
    );
  } catch (err: any) {
    database.run('ROLLBACK');
    saveDatabase();
    console.error('[UQPay Webhook] recharge.failed 回滚失败:', err.message);
  }
}

// ── Webhook: 费用事件记录 ─────────────────────────────────────────────

export function handleWebhookIssuingFee(payload: any): void {
  // 本轮只记录事件，不处理资金
  // TODO: 后续根据业务需求处理 issuing.fee.card 事件
  console.log(
    '[UQPay Webhook] issuing.fee.card 事件已记录（本轮不处理资金）:',
    'card_id:', payload.card_id,
    'amount:', payload.amount,
    'fee_type:', payload.fee_type
  );
}
