const sql = require("sql.js");
const fs = require("fs");

async function main() {
  const SQL = await sql();
  const buf = fs.readFileSync("./data/vcc.db");
  const db = new SQL.Database(buf);

  console.log("=== uqpay_recharge_orders 表结构 ===");
  let r = db.exec("PRAGMA table_info(uqpay_recharge_orders)");
  console.log(JSON.stringify(r[0] ? r[0].values : "err"));

  console.log("=== cards 表结构 ===");
  r = db.exec("PRAGMA table_info(cards)");
  console.log(JSON.stringify(r[0] ? r[0].values : "err"));

  console.log("=== uqpay_recharge_orders 最近5条（所有列）===");
  r = db.exec("SELECT * FROM uqpay_recharge_orders ORDER BY id DESC LIMIT 5");
  if (r[0]) {
    console.log(JSON.stringify(r[0].columns));
    console.log(JSON.stringify(r[0].values));
  }

  console.log("=== 按 channel 区分卡余额（猜列名）===");
  r = db.exec("SELECT DISTINCT channel FROM cards");
  console.log("distinct channels:", JSON.stringify(r[0] ? r[0].values : "err"));
  r = db.exec("SELECT SUM(balance) FROM cards WHERE channel LIKE '%UQPAY%'");
  console.log("UQPay balance:", JSON.stringify(r[0] ? r[0].values : "err"));
}
main().catch(e=>console.error(e));
