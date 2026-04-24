/**
 * CoinPal IPN 异步回调处理
 * 文档：https://docs.coinpal.io/ → IPN 异步回调
 *
 * CoinPal 在链上确认后向 notifyURL 发 POST，参数包括：
 * version / requestId / merchantNo / orderNo / reference / orderCurrency
 * orderAmount / dueCurrency / dueAmount / selectedWallet / paidCurrency / paidAmount
 * paidAddress / confirmedTime / status / remark / sign
 */

import { Router } from 'express';
import db, { getDb, saveDatabase } from '../db';

const router = Router();

// ── CoinPal 验签（复用 SDK 中逻辑）─────────────────────────────
function verifyCoinPalSign(
  secretKey: string,
  params: Record<string, string>
): boolean {
  const crypto = require('crypto');
  const { sign, ...rest } = params;
  const raw = secretKey
    + (rest['requestId'] ? rest['requestId'] : '')
    + (rest['merchantNo'] ? rest['merchantNo'] : '')
    + (rest['orderNo'] ? rest['orderNo'] : '')
    + (rest['orderAmount'] ? rest['orderAmount'] : '')
    + (rest['orderCurrency'] ? rest['orderCurrency'] : '');
  return crypto.createHash('sha256').update(raw).digest('hex') === sign;
}

// ── IPN 回调入口 ──────────────────────────────────────────────
router.post('/notify', async (req, res) => {
  const body = req.body as Record<string, string>;
  console.log('[CoinPal IPN] 收到回调:', JSON.stringify(body));

  try {
    // 1. 提取必要字段
    const {
      version, requestId, merchantNo, orderNo, reference,
      orderCurrency, orderAmount,
      paidCurrency, paidAmount, paidAddress,
      confirmedTime, status, remark, sign,
    } = body;

    if (!orderNo) {
      console.warn('[CoinPal IPN] 缺少 orderNo');
      return res.status(400).send('Missing orderNo');
    }

    // 2. 从数据库获取 secretKey（通过 merchantNo 查找渠道配置）
    const channel = db.prepare(
      "SELECT * FROM card_channels WHERE channel_code = 'COINPAL' AND status = 1"
    ).get() as any;
    if (!channel) {
      console.warn('[CoinPal IPN] 未找到 COINPAL 渠道配置');
      return res.status(500).send('Channel not configured');
    }
    const secretKey = channel.api_secret ? channel.api_secret : '';

    // 3. 验签
    if (!verifyCoinPalSign(secretKey, body)) {
      console.warn('[CoinPal IPN] 签名验证失败, orderNo:', orderNo);
      return res.status(403).send('Invalid signature');
    }

    // 4. 查找本地订单
    const order = db.prepare('SELECT * FROM usdt_orders WHERE order_no = ?').get(orderNo) as any;
    if (!order) {
      console.warn('[CoinPal IPN] 订单不存在:', orderNo);
      return res.status(404).send('Order not found');
    }

    // 5. 判断状态并更新
    // CoinPal 状态列表：unpaid / pending / partial_paid_confirming / partial_paid /
    //                    paid_confirming / paid / failed
    let newStatus = 0; // 待处理
    let isSuccess = false;

    if (status === 'paid' || status === 'paid_confirming' || status === 'partial_paid') {
      newStatus = 1;   // 充值成功
      isSuccess = true;
    } else if (status === 'failed') {
      newStatus = 2;   // 充值失败
      isSuccess = false;
    } else {
      // pending / partial_paid_confirming 等中间状态，记录但不完成
      console.log(`[CoinPal IPN] 状态[${status}]，订单[${orderNo}]暂不处理`);
    }

    // 6. 更新订单（仅 status=0 → newStatus 的原子更新，防重复入账）
    const now = new Date().toISOString();
    if (newStatus !== 0) {
      const existingPaidAddress = order.paid_address ? order.paid_address : null;
      const existingPaidAmount = order.paid_amount ? order.paid_amount : null;
      const existingConfirmedAt = order.confirmed_at ? order.confirmed_at : null;
      const existingChannelOrderNo = order.channel_order_no ? order.channel_order_no : null;

      // 用底层 database 直接执行 UPDATE，获取 changes 判断是否真的从 0 更新
      const database = getDb();
      database.run(
        `UPDATE usdt_orders SET
          status = ?,
          paid_address = COALESCE(?, ?),
          paid_amount = COALESCE(?, ?),
          confirmed_at = COALESCE(?, ?),
          channel_order_no = COALESCE(?, ?),
          updated_at = ?
        WHERE order_no = ? AND status = 0`,
        newStatus,
        paidAddress ? paidAddress : null,
        existingPaidAddress,
        paidAmount ? paidAmount : null,
        existingPaidAmount,
        confirmedTime ? confirmedTime : null,
        existingConfirmedAt,
        reference ? reference : null,
        existingChannelOrderNo,
        now,
        orderNo
      );

      // sql.js: 获取 affected rows
      const didUpdate = database.getRowsModified() > 0;
      saveDatabase();
      console.log(`[CoinPal IPN] 订单[${orderNo}] 状态更新: ${didUpdate ? '成功' : '跳过(已是终态)'} →[${newStatus}] (${status})`);

      // 7. 充值成功且确实是从 0→1 更新 → 才给用户钱包加款
      if (isSuccess && didUpdate && order.user_id) {
        const userId = order.user_id;
        const creditAmount = paidAmount ? parseFloat(paidAmount) : parseFloat(order.amount_usdt);
        if (creditAmount > 0 && Number.isFinite(creditAmount)) {
          try {
            const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;
            const balanceBefore = wallet ? wallet.balance_usdt : 0;
            if (wallet) {
              db.prepare('UPDATE wallets SET balance_usdt = balance_usdt + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
                .run(creditAmount, userId);
            } else {
              db.prepare('INSERT INTO wallets (user_id, balance_usdt, balance_usd, locked_usd) VALUES (?, ?, 0, 0)')
                .run(userId, creditAmount);
            }
            const balanceAfter = (wallet ? wallet.balance_usdt : 0) + creditAmount;

            // 写入钱包流水
            db.prepare(`
              INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type)
              VALUES (?, 'TOPUP', ?, ?, ?, 'USDT', ?, 'usdt_order')
            `).run(userId, creditAmount, balanceBefore, balanceAfter, `CoinPal 充值到账 订单${orderNo}`);

            console.log(`[CoinPal IPN] 用户[${userId}] 钱包到账 ${creditAmount} USDT (${balanceBefore} → ${balanceAfter})`);
          } catch (e: any) {
            console.error('[CoinPal IPN] 钱包加款失败:', e.message);
          }
        }
      }
    }

    // 8. 返回 success 给 CoinPal（重要：否则会重试）
    return res.status(200).send('SUCCESS');

  } catch (err: any) {
    console.error('[CoinPal IPN] 处理异常:', err.message);
    return res.status(500).send('Server error');
  }
});

export default router;