/**
 * UQPay SDK 诊断脚本（仅开发/管理员使用）
 *
 * 执行方式（开发机）：
 *   cd server && npx tsx src/scripts/diagnose-uqpay.ts
 *
 * 执行方式（服务器）：
 *   cd /opt/huifu/server && npx tsx src/scripts/diagnose-uqpay.ts
 *
 * 诊断内容：
 *   1. Token 获取是否成功
 *   2. /api/v1/accounts 返回数量（Issuing 场景通常为空）
 *   3. /api/v1/balances 返回数量（非 issuing，available_balance 通常为 0）
 *   4. /api/v1/issuing/balances 返回数量（✅ 充值资金来源）
 *   5. USD issuing balance 是否存在
 *   6. USD balance_id / account_id 脱敏输出
 *   7. available_balance / balance / status
 *
 * 安全约束：
 *   - 不输出 token / clientId / apiKey
 *   - 不执行真实充值
 *   - 不修改钱包余额 / 卡余额
 */

import { UqPaySDK } from '../channels/uqpay';

function maskId(id: string): string {
  if (!id || id.length <= 12) return id ? `${id.slice(0, 4)}...${id.slice(-4)}` : '(空)';
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

async function main() {
  console.log('===========================================');
  console.log('  UQPay SDK 诊断工具（开发/管理员专用）');
  console.log('  注意：不执行真实充值，不修改余额');
  console.log('===========================================\n');

  // ── 加载 UQPay 配置 ────────────────────────────────────────────────────────
  // 配置来源优先级：
  //   1. 环境变量 UQPAY_CLIENT_ID / UQPAY_API_KEY
  //   2. card_channels 表 config_json（生产环境）
  // 此脚本使用环境变量，生产环境由路由层从 DB 读取
  const clientId = process.env.UQPAY_CLIENT_ID || process.env.UQ_CLIENT_ID;
  const apiKey   = process.env.UQPAY_API_KEY     || process.env.UQ_API_KEY;

  if (!clientId || !apiKey) {
    console.error('缺少 UQPay 凭据，请设置环境变量 UQPAY_CLIENT_ID 和 UQPAY_API_KEY');
    console.error('   或者联系管理员配置 card_channels 表中的 config_json');
    process.exit(1);
  }

  const sdk = new UqPaySDK({ clientId, apiKey });

  // ── Step 1: Token + 基础连通性 + 全量诊断 ─────────────────────────────────
  console.log('Step 1: Token + SDK 诊断...\n');
  const diag = await sdk.diagnose();

  if (!diag.tokenOk) {
    console.error('Token 获取失败:', diag.error || '未知错误');
    console.error('请检查 UQPAY_CLIENT_ID / UQPAY_API_KEY 是否正确');
    process.exit(1);
  }
  console.log('Token 获取成功');
  console.log(`  持卡人数量: ${diag.cardholderCount}`);
  console.log(`  卡产品数量: ${diag.cardProductCount}`);
  if (diag.error) {
    console.warn(`  诊断部分错误: ${diag.error}`);
  }

  // ── Step 2: /api/v1/accounts（Issuing 场景不适用） ─────────────────────────
  console.log('\nStep 2: /api/v1/accounts 诊断...\n');
  console.log(`  返回数量: ${diag.accountsCount}`);
  if (diag.accountsCount === 0) {
    console.log('  结论: 此接口对 Issuing 卡场景返回空数组');
    console.log('  说明: /api/v1/accounts 不适用于 Issuing 卡充值资金来源查询');
    console.log('  替代: 请使用 /api/v1/issuing/balances（见 Step 4）');
  } else {
    console.warn(`  注意: 返回 ${diag.accountsCount} 个账户，但 Issuing 场景通常为空`);
  }

  // ── Step 3: /api/v1/balances（非 issuing） ────────────────────────────────
  console.log('\nStep 3: /api/v1/balances 诊断...\n');
  console.log(`  返回数量: ${diag.balancesCount}`);
  if (diag.balancesCount > 0) {
    console.log('  结论: 此接口返回多币种余额，但 available_balance 通常为 0');
    console.log('  说明: /api/v1/balances 是非 issuing 级别的余额，不适用于 Issuing 卡充值');
  }

  // ── Step 4: /api/v1/issuing/balances（充值资金来源） ─────────────────────
  console.log('\nStep 4: /api/v1/issuing/balances 诊断（充值资金来源）...\n');
  if (diag.issuingBalances.length === 0) {
    console.warn('  Issuing 余额列表为空！');
    console.warn('  可能原因: Issuing 账户未激活 / 无 Issuing 权限 / API Key 不对');
  } else {
    console.log(`  返回数量: ${diag.issuingBalances.length}`);
    console.log();
    console.log(`  ${'balance_id'.padEnd(20)}  Currency   Available    Balance    Status`);
    console.log('  ' + '-'.repeat(80));
    for (const b of diag.issuingBalances) {
      const avail = `$${b.available_balance.toFixed(2)}`;
      const bal = `$${b.balance.toFixed(2)}`;
      console.log(
        `  ${maskId(b.balance_id).padEnd(20)}  ${(b.currency || '?').padEnd(8)}  ${avail.padEnd(11)}  ${bal.padEnd(11)}  ${b.balance_status || '?'}`
      );
    }
  }

  // ── Step 5: USD Issuing Balance 识别 ──────────────────────────────────────
  console.log('\nStep 5: USD Issuing Balance 识别...\n');
  if (diag.usdIssuingBalance) {
    const b = diag.usdIssuingBalance;
    console.log('  USD issuing balance 已识别:');
    console.log(`    balance_id       : ${maskId(b.balance_id)}`);
    console.log(`    available_balance: $${b.available_balance.toFixed(2)}`);
    console.log(`    balance          : $${b.balance.toFixed(2)}`);
    console.log(`    status           : ${b.balance_status}`);
    console.log();
    console.log(`  充值时传入 balanceId = "${b.balance_id}"`);
    console.log();
  } else {
    console.warn('  未找到 USD issuing balance！');
    console.warn('  充值时可能无法指定 balance_id，请确认 Issuing 账户配置');
  }

  // ── Step 6: rechargeCard dry-run 说明 ─────────────────────────────────────
  console.log('===========================================');
  console.log('  rechargeCard Dry-Run 说明（不执行真实充值）');
  console.log('===========================================');
  console.log();
  console.log('  方法签名:');
  console.log('    rechargeCard(cardId, amount, idempotencyKey, options?)');
  console.log();
  console.log('  使用 issuing API（不要求 card_number / PAN）:');
  console.log('    POST /api/v1/issuing/cards/{cardId}/recharge');
  console.log('    Body: { amount: number }');
  console.log('    可选: { balance_id: issuing_balance_id }');
  console.log();
  console.log('  安全约束:');
  console.log('    - 不使用 card_number / PAN');
  console.log('    - 不使用 PAN Token 充值');
  console.log('    - 不保存 CVV');
  console.log('    - 不输出 token / clientId / apiKey');
  console.log('    - 不修改钱包余额 / 卡余额（SDK 层不涉及）');
  console.log();
  if (diag.usdIssuingBalance) {
    console.log('  调用示例（沙盒测试金额，需后续确认）:');
    console.log('    const result = await sdk.rechargeCard(');
    console.log('      "UQPay-card-UUID",');
    console.log('      10.00,');
    console.log('      `topup-${userId}-${Date.now()}`,');
    console.log(`      { balanceId: "${diag.usdIssuingBalance.balance_id}" }`);
    console.log('    );');
    console.log();
  }
  console.log('  响应结构 (UqPayRechargeResponse):');
  console.log('    card_id, card_order_id, recharge_amount,');
  console.log('    recharge_status, balance_after, card_available_balance,');
  console.log('    recharge_time, balance_id, raw_json');
  console.log();

  console.log('===========================================');
  console.log('  诊断完成');
  console.log('===========================================');
}

main().catch(err => {
  console.error('\n脚本异常退出:', err?.message || err);
  process.exit(1);
});
