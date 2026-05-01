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
    return JSON.stringify(res[0].columns) + "\n  " + JSON.stringify(res[0].values);
  }

  console.log("=== 订单 id=8（修正列名）===");
  console.log(fmt(q("SELECT id,user_id,status,amount,created_at FROM uqpay_recharge_orders WHERE id=8")));

  console.log("=== 订单 id=9（修正列名）===");
  console.log(fmt(q("SELECT id,user_id,status,amount,created_at FROM uqpay_recharge_orders WHERE id=9")));

  console.log("=== 最近 5 条订单（修正列名）===");
  console.log(fmt(q("SELECT id,user_id,status,amount,created_at FROM uqpay_recharge_orders ORDER BY id DESC LIMIT 5")));

  console.log("=== cards channel_code 枚举 ===");
  console.log(fmt(q("SELECT DISTINCT channel_code FROM cards")));

  console.log("=== UQPay 卡总余额（channel_code）===");
  console.log(fmt(q("SELECT SUM(balance) FROM cards WHERE channel_code='UQPAY'")));

  console.log("=== 所有 channel_code 卡余额汇总 ===");
  console.log(fmt(q("SELECT channel_code, SUM(balance) as sum_bal, COUNT(*) as cnt FROM cards GROUP BY channel_code")));

  console.log("=== 日志错误：uqpay-reconcile（最近 30 行）===");
}
main().catch(e=>console.error(e));
