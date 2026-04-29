/**
 * UQPay 充值订单批量补偿脚本
 *
 * 用法:
 *   npm run reconcile:uqpay-recharges
 *   npm run reconcile:uqpay-recharges -- --dry-run
 *   npm run reconcile:uqpay-recharges -- --dry-run --json
 *   npm run reconcile:uqpay-recharges -- --max=50 --min-age=5
 *
 * 安全:
 * - 不输出 token/clientId/apiKey/PAN/CVV
 * - 不执行充值
 * - 不修改钱包余额（除非确认失败后回滚）
 * - --dry-run 模式下不修改任何数据
 *
 * 处理逻辑：
 * 1. 扫描 status=PENDING/UNKNOWN 且创建时间超过 min-age 分钟的订单
 * 2. 调用 reconcileRechargeOrder() 逐条处理
 * 3. 输出处理结果
 */

import { reconcilePendingOrders } from '../services/uqpay-recharge';

function parseArgs(): { max: number; minAge: number; dryRun: boolean; json: boolean } {
  const args = process.argv.slice(2);
  const opts = { max: 10, minAge: 5, dryRun: false, json: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max' && i + 1 < args.length) {
      opts.max = Math.max(1, parseInt(args[++i], 10) || 10);
    } else if (args[i] === '--min-age' && i + 1 < args.length) {
      opts.minAge = Math.max(0, parseInt(args[++i], 10) || 5);
    } else if (args[i] === '--dry-run') {
      opts.dryRun = true;
    } else if (args[i] === '--json') {
      opts.json = true;
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  const startTime = Date.now();

  const result = await reconcilePendingOrders(opts.max, opts.minAge, undefined, undefined, opts.dryRun);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  if (opts.json) {
    // JSON 模式：只输出必要字段，不输出敏感数据
    const output: Record<string, any> = {
      dryRun: result.dryRun,
      scanned: result.total,
      wouldProcess: result.wouldProcess,
      wouldMarkSuccess: result.wouldMarkSuccess,
      wouldMarkFailed: result.wouldMarkFailed,
      wouldRemainPending: result.wouldRemainPending,
      readOnlyExternalCall: result.readOnlyExternalCall,
      errors: result.errors,
      elapsed_seconds: parseFloat(elapsed),
    };

    // 非 dry-run 模式补充实际结果
    if (!result.dryRun) {
      output.succeeded = result.succeeded;
      output.failed = result.failed;
      output.unchanged = result.unchanged;
    }

    console.log(JSON.stringify(output));
    return;
  }

  // 表格模式
  console.log('=== UQPay 充值订单批量补偿 ===');
  console.log('时间:', new Date().toISOString());
  console.log(`模式: ${opts.dryRun ? 'DRY-RUN（不写库）' : '正常执行'}`);
  console.log('');

  console.log(`扫描订单数: ${result.total}`);
  if (opts.dryRun) {
    console.log(`  将处理:          ${result.wouldProcess}`);
    console.log(`  将标记 SUCCESS:  ${result.wouldMarkSuccess}`);
    console.log(`  将标记 FAILED:   ${result.wouldMarkFailed}`);
    console.log(`  将保持 PENDING:  ${result.wouldRemainPending}`);
    console.log(`  外部只读调用:    ${result.readOnlyExternalCall}`);
  } else {
    console.log(`处理结果: 总计=${result.total}, 成功=${result.succeeded}, 失败=${result.failed}, 无变更=${result.unchanged}`);
  }
  console.log(`  异常数: ${result.errors.length}`);
  console.log(`  耗时:   ${elapsed}s`);
  console.log('');

  for (const r of result.results) {
    const tag = r.dryRun
      ? `🔷 [DRY-RUN] ${r.fromStatus} → ${r.toStatus}`
      : r.changed
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

  if (result.total === 0) {
    console.log('✅ 没有需要处理的 PENDING/UNKNOWN 订单。');
  }

  console.log('');
  console.log('Done.');
}

main().catch((err) => {
  console.error('脚本异常:', err);
  process.exit(1);
});
