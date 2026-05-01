const sql = require("sql.js");
const fs = require("fs");

async function main() {
  const SQL = await sql();
  const buf = fs.readFileSync("./data/vcc.db");
  const db = new SQL.Database(buf);

  function q(sqlStr) {
    try { return db.exec(sqlStr); }
    catch(e) { return [{values: [["err:" + e.message]]}]; }
  }

  function fmt(res) {
    if (!res || !res[0]) return "no results";
    return JSON.stringify(res[0].columns) + " => " + JSON.stringify(res[0].values);
  }

  console.log("=== 订单状态分布 ===");
  console.log(fmt(q("SELECT status, COUNT(*) as cnt FROM uqpay_recharge_orders GROUP BY status")));

  console.log("=== 订单 id=8 ===");
  console.log(fmt(q("SELECT id, user_id, status, amount_usd, created_at FROM uqpay_recharge_orders WHERE id=8")));

  console.log("=== 订单 id=9 ===");
  console.log(fmt(q("SELECT id, user_id, status, amount_usd, created_at FROM uqpay_recharge_orders WHERE id=9")));

  console.log("=== 最近 5 条订单 ===");
  console.log(fmt(q("SELECT id, user_id, status, amount_usd, created_at FROM uqpay_recharge_orders ORDER BY id DESC LIMIT 5")));

  console.log("=== user1 钱包 ===");
  console.log(fmt(q("SELECT id, user_id, balance_usd, balance_usdt FROM wallets WHERE user_id=1")));

  console.log("=== user13 钱包 ===");
  console.log(fmt(q("SELECT id, user_id, balance_usd, balance_usdt FROM wallets WHERE user_id=13")));

  console.log("=== card id=6 ===");
  console.log(fmt(q("SELECT id, user_id, balance, status FROM cards WHERE id=6")));

  console.log("=== card id=7 ===");
  console.log(fmt(q("SELECT id, user_id, balance, status FROM cards WHERE id=7")));

  console.log("=== 钱包总额 ===");
  console.log(fmt(q("SELECT SUM(balance_usd), SUM(balance_usdt) FROM wallets")));

  console.log("=== UQPay 卡总余额 ===");
  console.log(fmt(q("SELECT SUM(balance) FROM cards WHERE channel='UQPAY'")));

  console.log("=== reconcile_alerts 计数 ===");
  console.log(fmt(q("SELECT COUNT(*) FROM reconcile_alerts")));
}

main().catch(e => console.error("Fatal:", e));
