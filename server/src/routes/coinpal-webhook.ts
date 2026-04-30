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
  // 脱敏日志：不输出 sign/secretKey 明文
  const safeBody = { ...body, sign: body.sign ? body.sign.substring(0, 8) + '...' : 'N/A' };
  console.log('[CoinPal IPN] 收到回调:', JSON.stringify(safeBody));

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
    const signOk = verifyCoinPalSign(secretKey, body);
    console.log(`[CoinPal IPN] 验签结果: orderNo=${orderNo}, reference=${reference || 'N/A'}, status=${status}, paidAmount=${paidAmount || 'N/A'}, signOk=${signOk}`);

    if (!signOk) {
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
    // CoinPal 状态列表：
    //   unpaid                  — 订单创建成功
    //   pending                 — 支付处理中
    //   partial_paid_confirming — 部分支付，待公链确认
    //   partial_paid            — 部分支付，已确认
    //   paid_confirming         — 支付成功，待公链确认
    //   paid                    — 支付成功，公链已确认
    //   failed                  — 支付失败
    let newStatus = 0; // 不变更
    let isSuccess = false;
    let isFailed = false;

    if (status === 'paid') {
      // 只有 paid（公链已确认）才允许入账
      newStatus = 1;   // 充值成功
      isSuccess = true;
    } else if (status === 'failed') {
      newStatus = 2;   // 充值失败
      isFailed = true;
    } else if (status === 'paid_confirming') {
      // 待公链确认：更新订单信息但不入账，等 paid 回调再入账
      console.log(`[CoinPal IPN] paid_confirming 订单[${orderNo}]，更新信息但不入账`);
    } else if (status === 'partial_paid') {
      // 部分支付已确认：不入账，标记失败
      newStatus = 2;
      isFailed = true;
      console.log(`[CoinPal IPN] partial_paid 订单[${orderNo}]，部分支付不自动入账，标记失败`);
    } else {
      // unpaid / pending / partial_paid_confirming 等中间状态，记录但不处理
      console.log(`[CoinPal IPN] 状态[${status}]，订单[${orderNo}]暂不处理`);
    }

    // 6. 更新订单
    const now = new Date().toISOString();

    // 6a. 对于终态（paid / failed / partial_paid），原子更新 status
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
        [newStatus,
        paidAddress ? paidAddress : null,
        existingPaidAddress,
        paidAmount ? paidAmount : null,
        existingPaidAmount,
        confirmedTime ? confirmedTime : null,
        existingConfirmedAt,
        reference ? reference : null,
        existingChannelOrderNo,
        now,
        orderNo]
      );

      // sql.js: 获取 affected rows
      const didUpdate = database.getRowsModified() > 0;
      saveDatabase();
      console.log(`[CoinPal IPN] 订单[${orderNo}] 状态更新: ${didUpdate ? '成功' : '跳过(已是终态)'} →[${newStatus}] (${status})`);

      // 7. 充值成功且确实是从 0→1 更新 → 才给用户钱包加款
      if (isSuccess && didUpdate && order.user_id) {
        const userId = order.user_id;
        const grossAmount = paidAmount ? parseFloat(paidAmount) : parseFloat(order.amount_usdt);
        if (grossAmount > 0 && Number.isFinite(grossAmount)) {
          try {
            // ⚠️ 费率锁定原则：优先使用创建订单时保存的 fee_rate
            // 不允许 webhook 入账时重新读取最新 config_json 来结算老订单
            let feeRate = 0;
            let feeEnabled = false;
            const orderFeeRate = order.fee_rate;
            if (orderFeeRate != null && Number(orderFeeRate) > 0) {
              feeRate = Number(orderFeeRate);
              feeEnabled = true;
            } else if (orderFeeRate != null && Number(orderFeeRate) === 0) {
              feeEnabled = false;
            } else {
              // 历史订单（无 fee_rate 字段）→ fallback 到当前 config 或默认 5%
              try {
                const channel = db.prepare(
                  "SELECT * FROM card_channels WHERE channel_code = 'COINPAL' AND status = 1"
                ).get() as any;
                if (channel && channel.config_json) {
                  const cfg = JSON.parse(channel.config_json);
                  if (cfg.depositFeeEnabled !== false) {
                    feeEnabled = true;
                    feeRate = Number(cfg.depositFeeRate || 0.05);
                  }
                } else {
                  feeEnabled = true;
                  feeRate = 0.05;
                }
              } catch (_) {
                feeEnabled = true;
                feeRate = 0.05;
              }
            }

            // 计算手续费和净额（toFixed 6 避免浮点误差）
            const feeAmount = feeEnabled ? Number((grossAmount * feeRate).toFixed(6)) : 0;
            const netAmount = Number((grossAmount - feeAmount).toFixed(6));

            // 更新订单手续费字段（COALESCE 保护以免覆盖已写入的值）
            const database = getDb();
            database.run(
              `UPDATE usdt_orders SET
                gross_amount = COALESCE(gross_amount, ?),
                fee_rate = COALESCE(fee_rate, ?),
                fee_amount = ?, net_amount = ?,
                updated_at = ?
              WHERE order_no = ?`,
              [grossAmount, feeRate, feeAmount, netAmount, now, orderNo]
            );
            saveDatabase();

            // 写入 wallet.balance_usdt（只加净额）
            const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;
            const balanceBefore = wallet ? wallet.balance_usdt : 0;
            if (wallet) {
              db.prepare('UPDATE wallets SET balance_usdt = balance_usdt + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
                .run(netAmount, userId);
            } else {
              db.prepare('INSERT INTO wallets (user_id, balance_usdt, balance_usd, locked_usd) VALUES (?, ?, 0, 0)')
                .run(userId, netAmount);
            }
            const balanceAfter = Number((balanceBefore + netAmount).toFixed(6));

            // 写入钱包流水（DEPOSIT_USDT 用户到账）
            db.prepare(`
              INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type)
              VALUES (?, 'DEPOSIT_USDT', ?, ?, ?, 'USDT', ?, 'usdt_order')
            `).run(userId, netAmount, balanceBefore, balanceAfter, `CoinPal 充值到账 订单${orderNo}`);

            // 如果收了手续费，再写一条 DEPOSIT_FEE 流水（便于审计）
            if (feeAmount > 0) {
              db.prepare(`
                INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type)
                VALUES (?, 'DEPOSIT_FEE', ?, ?, ?, 'USDT', ?, 'usdt_order')
              `).run(userId, -feeAmount, balanceAfter, balanceAfter, `CoinPal 充值手续费 订单${orderNo}`);
            }

            console.log(`[CoinPal IPN] 用户[${userId}] 充值到账: gross=${grossAmount}, fee=${feeAmount}, net=${netAmount} (${balanceBefore} → ${balanceAfter})`);
          } catch (e: any) {
            console.error('[CoinPal IPN] 钱包加款失败:', e.message);
          }
        }
      }
    }

    // 6b. 对于 paid_confirming 中间状态，更新订单的 paid_amount/paid_address 但不改 status
    if (newStatus === 0 && status === 'paid_confirming' && order.status === 0) {
      const database = getDb();
      database.run(
        `UPDATE usdt_orders SET
          paid_address = COALESCE(?, paid_address),
          paid_amount = COALESCE(?, paid_amount),
          channel_order_no = COALESCE(?, channel_order_no),
          updated_at = ?
        WHERE order_no = ? AND status = 0`,
        [
          paidAddress ? paidAddress : null,
          paidAmount ? paidAmount : null,
          reference ? reference : null,
          now,
          orderNo
        ]
      );
      saveDatabase();
      console.log(`[CoinPal IPN] 订单[${orderNo}] paid_confirming 信息已更新，paidAmount=${paidAmount || 'N/A'}`);
    }

    // 8. 返回 success 给 CoinPal（重要：否则会重试）
    return res.status(200).send('SUCCESS');

  } catch (err: any) {
    console.error('[CoinPal IPN] 处理异常:', err.message);
    return res.status(500).send('Server error');
  }
});

export default router;