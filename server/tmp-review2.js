const sql = require("sql.js");
const fs = require("fs");
const buf = fs.readFileSync("./data/vcc.db");
const db = new sql.Database(buf);

function query(sqlStr) {
  return db.exec(sqlStr);
}

function getVal(res) {
  if (!res || !res[0] || !res[0].values) return null;
  return res[0].values;
}

// 1. 订单状态分布
console.log("=== 订单状态分布 ===");
let r = db.exec("SELECT status, COUNT(*) as cnt FROM uqpay_recharge_orders GROUP BY status");
console.log(JSON.stringify(r[0] ? r[0].values : []));

// 2. 订单 id=8 和 id=9
console.log("=== 订单 id=8 和 id=9 ===");
["8","9"].forEach(id => {
  let rr = db.exec("SELECT id, user_id, status, amount_usd, created_at FROM uqpay_recharge_orders WHERE id=" + id);
  console.log("order_" + id + ":" + JSON.stringify(rr[0] ? rr[0].values : "not found"));
});

// 3. 最近 5 条订单
console.log("=== 最近 5 条订单 ===");
r = db.exec("SELECT id, user_id, status, amount_usd, created_at FROM uqpay_recharge_orders ORDER BY id DESC LIMIT 5");
console.log(JSON.stringify(r[0] ? r[0].values : []));

// 4. user1 钱包
console.log("=== user1 (id=1) 钱包 ===");
r = db.exec("SELECT id, user_id, balance_usd, balance_usdt FROM wallets WHERE user_id=1");
console.log(JSON.stringify(r[0] ? r[0].values : "not found"));

// 5. user13 钱包
console.log("=== user13 (id=13) 钱包 ===");
r = db.exec("SELECT id, user_id, balance_usd, balance_usdt FROM wallets WHERE user_id=13");
console.log(JSON.stringify(r[0] ? r[0].values : "not found"));

// 6. cards id=6 和 id=7
console.log("=== cards id=6 和 id=7 ===");
["6","7"].forEach(id => {
  let rr = db.exec("SELECT id, user_id, balance, status FROM cards WHERE id=" + id);
  console.log("card_" + id + ":" + JSON.stringify(rr[0] ? rr[0].values : "not found"));
});

// 7. 钱包总额
console.log("=== 钱包总额 ===");
r = db.exec("SELECT SUM(balance_usd), SUM(balance_usdt) FROM wallets");
console.log(JSON.stringify(r[0] ? r[0].values : []));

// 8. UQPay 卡总余额
console.log("=== UQPay 卡总余额 ===");
r = db.exec("SELECT SUM(balance) FROM cards WHERE channel='UQPAY'");
console.log(JSON.stringify(r[0] ? r[0].values : []));

// 9. reconcile_alerts 计数
console.log("=== reconcile_alerts 计数 ===");
r = db.exec("SELECT COUNT(*) FROM reconcile_alerts");
console.log(JSON.stringify(r[0] ? r[0].values : []));

// 10. 日志错误检查（最近 50 行）
console.log("=== 日志错误检查 ===");
