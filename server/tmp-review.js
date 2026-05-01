const { getDb } = require("./dist/db.js");
const db = getDb();

console.log("=== 订单状态分布 ===");
try {
  const dist = db.prepare("SELECT status, COUNT(*) as cnt FROM uqpay_recharge_orders GROUP BY status").all();
  console.log(JSON.stringify(dist));
} catch(e) { console.log("err:", e.message); }

console.log("=== 订单 id=8 和 id=9 ===");
["8","9"].forEach(id => {
  try {
    const r = db.prepare("SELECT id, user_id, status, amount_usd, created_at FROM uqpay_recharge_orders WHERE id=?").get(id);
    console.log("order_" + id + ":" + JSON.stringify(r));
  } catch(e) { console.log("err order_" + id + ":" + e.message); }
});

console.log("=== 最近 5 条订单 ===");
try {
  const recent = db.prepare("SELECT id, user_id, status, amount_usd, created_at FROM uqpay_recharge_orders ORDER BY id DESC LIMIT 5").all();
  console.log(JSON.stringify(recent));
} catch(e) { console.log("err:", e.message); }

console.log("=== user1 (id=1) 钱包 ===");
try {
  const w = db.prepare("SELECT id, user_id, balance_usd, balance_usdt FROM wallets WHERE user_id=1").get();
  console.log(JSON.stringify(w));
} catch(e) { console.log("err:", e.message); }

console.log("=== user13 (id=13) 钱包 ===");
try {
  const w = db.prepare("SELECT id, user_id, balance_usd, balance_usdt FROM wallets WHERE user_id=13").get();
  console.log(JSON.stringify(w));
} catch(e) { console.log("err:", e.message); }

console.log("=== cards id=6 和 id=7 ===");
["6","7"].forEach(id => {
  try {
    const r = db.prepare("SELECT id, user_id, balance, status FROM cards WHERE id=?").get(id);
    console.log("card_" + id + ":" + JSON.stringify(r));
  } catch(e) { console.log("err card_" + id + ":" + e.message); }
});

console.log("=== 钱包总额 ===");
try {
  const t = db.prepare("SELECT SUM(balance_usd) as sum_usd, SUM(balance_usdt) as sum_usdt FROM wallets").get();
  console.log(JSON.stringify(t));
} catch(e) { console.log("err:", e.message); }

console.log("=== UQPay 卡总余额 ===");
try {
  const t = db.prepare("SELECT SUM(balance) as sum_balance FROM cards WHERE channel=?").get("UQPAY");
  console.log(JSON.stringify(t));
} catch(e) { console.log("err:", e.message); }

console.log("=== reconcile_alerts 计数 ===");
try {
  const c = db.prepare("SELECT COUNT(*) as cnt FROM reconcile_alerts").get();
  console.log(JSON.stringify(c));
} catch(e) { console.log("err:", e.message); }
