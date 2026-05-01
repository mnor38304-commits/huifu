import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data/vcc.db');
  const buf = fs.readFileSync(dbPath);
  const SQL = await initSqlJs();
  const db = new SQL.Database(buf);

  const cardId = '46cea291-bbf3-4d36-972f-bb2adea48186';
  const chId = '9a389088-d36a-45a7-9184-35622bff3f7e';

  // Check if already exists
  const existing = db.exec("SELECT id FROM cards WHERE external_id = '" + cardId + "'");
  if (existing.length > 0 && existing[0].values.length > 0) {
    console.log('Already in DB: id=' + existing[0].values[0][0]);
  } else {
    db.run("INSERT INTO cards (user_id, channel_code, external_id, balance, currency, status, uqpay_cardholder_id, card_no_masked, card_type, card_no, card_name, credit_limit, expire_date, cvv) VALUES (13, 'UQPAY', '" + cardId + "', 0, 'USD', 1, '" + chId + "', '**** **** **** 0000', 1, 'test-uqpay-13', 'UQPay13 Test Card', 100, '2030-12-31', '000')");
    fs.writeFileSync(dbPath, db.export());
    console.log('Card bound OK');
  }

  // Show all user13 cards
  const ck = db.exec("SELECT id, user_id, channel_code, external_id, balance, currency, status, card_no_masked FROM cards WHERE user_id=13 ORDER BY id");
  if (ck.length > 0) {
    console.log('=== user_id=13 ALL cards ===');
    console.log('id | user_id | channel | external_id_hint | balance | currency | status | masked');
    ck[0].values.forEach((row: any[]) => {
      const ext = String(row[3] || '');
      const hint = ext.length > 8 ? ext.substring(0, 8) + '...' : ext;
      console.log(row[0] + ' | ' + row[1] + ' | ' + row[2] + ' | ' + hint + ' | ' + row[4] + ' | ' + row[5] + ' | ' + row[6] + ' | ' + row[7]);
    });
  }
  db.close();
}

main().catch(err => console.log('FATAL: ' + err.message));
