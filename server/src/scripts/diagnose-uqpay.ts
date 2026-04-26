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
 *   1. listAccounts() 是否可用
 *   2. USD account_id / balance_id 识别
 *   3. rechargeCard 不执行真实请求（dry-run 模式）
 *
 * 安全约束：
 *   - 不输出 token / clientId / apiKey
 *   - 不执行真实充值
 *   - 不修改钱包余额 / 卡余额
 */

import { UqPaySDK } from '../channels/uqpay';

async function main() {
  console.log('===========================================');
  console.log('  UQPay SDK 诊断工具（开发/管理员专用）');
  console.log('  注意：不执行真实充值，不修改余额');
  console.log('===========================================\n');

  // ── 加载 UQPay 配置 ────────────────────────────────────────────────────────
  // 配置来源：card_channels 表（生产环境从 DB 读取）
  // 此脚本读取环境变量或 .env 文件中的配置
  const clientId = process.env.UQPAY_CLIENT_ID || process.env.UQ_CLIENT_ID;
  const apiKey   = process.env.UQPAY_API_KEY     || process.env.UQ_API_KEY;

  if (!clientId || !apiKey) {
    console.error('❌ 缺少 UQPay 凭据，请设置环境变量 UQPAY_CLIENT_ID 和 UQPAY_API_KEY');
    console.error('   或者联系管理员配置 card_channels 表中的 config_json');
    process.exit(1);
  }

  const sdk = new UqPaySDK({ clientId, apiKey });

  // ── Step 1: Token + 基础连通性 ────────────────────────────────────────────
  console.log('📡 Step 1: 测试 Token 获取...\n');
  try {
    const diag = await sdk.diagnose();
    console.log('✅ Token 获取成功');
    console.log(`   持卡人数量: ${diag.cardholderCount}`);
    console.log(`   卡产品数量: ${diag.cardProductCount}`);
    if (diag.error) {
      console.warn(`⚠️  诊断过程有部分错误: ${diag.error}`);
    }
  } catch (err: any) {
    console.error('❌ Token 获取失败:', err?.message || err);
    console.error('   请检查 UQPAY_CLIENT_ID / UQPAY_API_KEY 是否正确');
    process.exit(1);
  }

  // ── Step 2: listAccounts 完整列表 ─────────────────────────────────────────
  console.log('\n📡 Step 2: 获取账户列表 (listAccounts)...\n');
  let accounts: Awaited<ReturnType<UqPaySDK['listAccounts']>> = [];
  try {
    accounts = await sdk.listAccounts();
    if (accounts.length === 0) {
      console.warn('⚠️  listAccounts 返回空列表，可能账户未激活或 API 无权访问');
    } else {
      console.log(`✅ 共 ${accounts.length} 个账户:\n`);
      console.log(`  ${'ID/Name'.padEnd(40)}  Currency   Available    Balance    Status`);
      console.log('  ' + '-'.repeat(88));
      for (const acc of accounts) {
        // 安全：只输出 id / name / currency / status，不输出 token / apiKey
        const avail = acc.available_balance != null ? `$${acc.available_balance.toFixed(2)}` : '  N/A  ';
        const bal   = acc.balance != null ? `$${acc.balance.toFixed(2)}` : '  N/A  ';
        const line  = `  ${acc.account_id.slice(0, 8)}... / ${acc.name || '(无名称)'}`;
        console.log(`  ${line.padEnd(48)} ${(acc.currency || '?').padEnd(8)} ${avail.padEnd(11)} ${bal.padEnd(11)} ${acc.status || '?'}`);
      }
    }
  } catch (err: any) {
    console.error('❌ listAccounts 调用失败:', err?.message || err);
    console.error('   可能原因：账户未激活 / 无 accounts 读权限 / API 版本不匹配');
  }

  // ── Step 3: USD 账户识别 ──────────────────────────────────────────────────
  console.log('\n📡 Step 3: 识别 USD 充值账户 (balance_id)...\n');
  if (accounts && accounts.length > 0) {
    const usdAccounts = accounts.filter(a => a.currency?.toUpperCase() === 'USD');
    if (usdAccounts.length === 0) {
      console.warn('⚠️  未找到 USD 账户，充值时可能无法指定 balance_id');
      console.warn('   可用账户币种:', [...new Set(accounts.map(a => a.currency))].join(', '));
    } else {
      console.log(`✅ 找到 ${usdAccounts.length} 个 USD 账户:\n`);
      for (const acc of usdAccounts) {
        console.log(`  ✅ account_id : ${acc.account_id}`);
        console.log(`     name       : ${acc.name || '(无名称)'}`);
        console.log(`     balance    : $${(acc.balance ?? 0).toFixed(2)}`);
        console.log(`     available  : $${(acc.available_balance ?? 0).toFixed(2)}`);
        console.log(`     status     : ${acc.status || '?'}`);
        console.log(`  → 充值时传入 balanceId = "${acc.account_id}"`);
        console.log();
      }
    }
  } else {
    console.warn('⚠️  无法识别（accounts 为空）');
  }

  // ── Step 4: rechargeCard dry-run ──────────────────────────────────────────
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
  console.log('    可选: { balance_id: account_id }');
  console.log();
  console.log('  安全约束:');
  console.log('    ❌ 不使用 card_number / PAN');
  console.log('    ❌ 不使用 PAN Token 充值');
  console.log('    ❌ 不保存 CVV');
  console.log('    ❌ 不输出 token / clientId / apiKey');
  console.log('    ❌ 不修改钱包余额 / 卡余额（SDK 层不涉及）');
  console.log();
  console.log('  调用示例（沙盒测试金额，需后续确认）:');
  console.log('    const result = await sdk.rechargeCard(');
  console.log('      "UQPay-card-UUID",   // card_id（来自 UQPay，非本地 cards.id）');
  console.log('      10.00,               // 金额（USD）');
  console.log('      `topup-${userId}-${Date.now()}`,');
  console.log('      { balanceId: "USD-account-id-from-listAccounts" }');
  console.log('    );');
  console.log();
  console.log('  响应结构 (UqPayRechargeResponse):');
  console.log('    card_id, card_order_id, recharge_amount,');
  console.log('    recharge_status, balance_after, card_available_balance,');
  console.log('    recharge_time, balance_id, raw_json');
  console.log();
  console.log('  ⚠️  本轮 PR-2 仅实现方法，不接入用户充值流程');
  console.log('     后续由 PR-3（重写 topupCard 逻辑）接入真实充值');
  console.log('     后续由 PR-4（Webhook 事件处理）对账更新卡余额');
  console.log();

  console.log('===========================================');
  console.log('  诊断完成');
  console.log('===========================================');
}

main().catch(err => {
  console.error('\n❌ 脚本异常退出:', err?.message || err);
  process.exit(1);
});
