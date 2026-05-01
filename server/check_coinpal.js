const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
(async()=>{
  const SQL = await initSqlJs();
  const buf = fs.readFileSync("/opt/huifu/server/data/vcc.db");
  const db = new SQL.Database(buf);
  // 1. usdt_orders id=14
  const o = db.exec("SELECT id, user_id, status, gross_amount, fee_rate, fee_amount, net_amount, created_at FROM usdt_orders WHERE id=14");
  console.log("=== ORDER 14 ===");
  console.log(JSON.stringify(o[0]?.values));
  // 2. user13 wallet
  const w = db.exec("SELECT id, user_id, balance_usd, balance_usdt, locked_usd FROM wallets WHERE user_id=13");
  console.log("=== USER13 WALLET ===");
  console.log(JSON.stringify(w[0]?.values));
  // 3. wallet_records for user13 deposit types
  const r = db.exec("SELECT id, user_id, type, amount, balance_after, reference_id, created_at FROM wallet_records WHERE user_id=13 AND type IN (DEPOSIT_USDT,DEPOSIT_FEE) ORDER BY id");
  console.log("=== WALLET_RECORDS_USER13_DEPOSIT ===");
  console.log(JSON.stringify(r[0]?.values));
  // 4a. reconcile_alerts count
  const a = db.exec("SELECT COUNT(*) FROM reconcile_alerts");
  console.log("=== RECONCILE_ALERTS_COUNT ===");
  console.log(JSON.stringify(a[0]?.values));
  // 4b. uqpay_recharge_orders status distribution
  const s = db.exec("SELECT status, COUNT(*) as cnt FROM uqpay_recharge_orders GROUP BY status");
  console.log("=== UQPAY_RECHARGE_STATUS_DIST ===");
  console.log(JSON.stringify(s[0]?.values));
  db.close();
})();
