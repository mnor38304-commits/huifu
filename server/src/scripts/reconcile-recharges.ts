/**
 * UQPay 充值订单批量补偿脚本
 *
 * 用法:
 *   npm run reconcile:uqpay-recharges
 *
 * 安全：
 * - 不输出 token/clientId/apiKey/PAN/CVV
 * - 不执行充值
 * - 不修改钱包余额（除非确认失败后回滚）
 *
 * 处理逻辑：
 * 1. 扫描 status=PENDING/UNKNOWN 且创建时间超过 5 分钟的订单
 * 2. 调用 reconcileRechargeOrder() 逐条处理
 * 3. 输出处理结果表格
 */

import { reconcilePendingOrders } from '../services/uqpay-recharge';

async function main() {
  console.log('=== UQPay 充值订单批量补偿 ===');
  console.log('时间:', new Date().toISOString());
  console.log('');

  const result = await reconcilePendingOrders(10, 5);

  console.log(`处理结果: 总计=${result.total}, 成功=${result.succeeded}, 失败=${result.failed}, 无变更=${result.unchanged}`);
  console.log('');

  for (const r of result.results) {
    const tag = r.changed
      ? `✅ ${r.fromStatus} → ${r.toStatus}`
      : `⏸️ ${r.fromStatus} (不变)`;
    console.log(`  ${tag} | ${r.detail.slice(0, 120)}`);
  }

  if (result.errors.length > 0) {
    console.log('');
    console.log('=== 错误列表 ===');
    for (const e of result.errors) {
      console.log(`  ❌ ${e}`);
    }
  }

  console.log('');
  console.log('Done.');
}

main().catch((err) => {
  console.error('脚本异常:', err);
  process.exit(1);
});
