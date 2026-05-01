/**
 * UQPay PENDING/UNKNOWN 告警扫描 CLI
 *
 * 用法:
 *   npm run alert:pending-orders
 *   npm run alert:pending-orders -- --max=50 --hours=24
 *   npm run alert:pending-orders -- --dry-run
 *   npm run alert:pending-orders -- --json
 *
 * 安全约束:
 * - 不修改订单状态
 * - 不改钱包/卡余额
 * - 不调用 UQPay 外部接口
 * - 不输出 token/clientId/apiKey/PAN/CVV
 */

import { scanPendingRechargeAlerts } from '../services/reconcile-alerts';
import { initDatabase } from '../db';

function parseArgs(): { max: number; hours: number; dryRun: boolean; json: boolean } {
  const args = process.argv.slice(2);
  const opts = { max: 50, hours: 24, dryRun: false, json: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max' && i + 1 < args.length) {
      opts.max = Math.max(1, parseInt(args[++i], 10) || 50);
    } else if (args[i] === '--hours' && i + 1 < args.length) {
      opts.hours = Math.max(1, parseInt(args[++i], 10) || 24);
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

  // 初始化数据库
  await initDatabase();

  const startTime = Date.now();

  const result = await scanPendingRechargeAlerts({
    maxOrders: opts.max,
    lookbackHours: opts.hours,
    dryRun: opts.dryRun,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  if (opts.json) {
    console.log(JSON.stringify({ ...result, elapsed_seconds: parseFloat(elapsed) }));
    return;
  }

  console.log('=== UQPay PENDING/UNKNOWN 告警扫描 ===');
  console.log('时间:', new Date().toISOString());
  console.log(`模式: ${opts.dryRun ? 'DRY-RUN（不写库）' : '正常执行'}`);
  console.log('');
  console.log(`扫描结果:`);
  console.log(`  扫描订单数:       ${result.scanned}`);
  console.log(`  新增告警数:       ${result.created}`);
  console.log(`  更新告警数:       ${result.updated}`);
  console.log(`  WARNING 级:       ${result.warnings}`);
  console.log(`  CRITICAL 级:      ${result.criticals}`);
  console.log(`  跳过（已处理）:   ${result.skipped}`);
  console.log(`  异常数:           ${result.errors.length}`);
  console.log(`  耗时:             ${elapsed}s`);
  console.log('');

  if (result.errors.length > 0) {
    console.log('=== 异常列表 ===');
    for (const e of result.errors) {
      console.log(`  ❌ ${e}`);
    }
    console.log('');
  }

  if (result.created === 0 && result.updated === 0 && result.errors.length === 0) {
    console.log('✅ 未发现异常，一切正常。');
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('脚本异常:', err);
  process.exit(1);
});
