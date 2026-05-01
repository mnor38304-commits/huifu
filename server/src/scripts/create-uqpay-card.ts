import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

async function main() {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data/vcc.db');
  const buf = fs.readFileSync(dbPath);
  const SQL = await initSqlJs();
  const db = new SQL.Database(buf);
  const rows = db.exec("SELECT * FROM card_channels WHERE UPPER(channel_code) = 'UQPAY' AND status = 1");
  if (!rows.length || !rows[0].values.length) { console.log(JSON.stringify({error:'UQPAY channel not found'})); return; }
  const cols = rows[0].columns;
  const vals = rows[0].values[0];
  const row: any = {};
  cols.forEach((c: string, i: number) => { row[c] = vals[i]; });
  const config = JSON.parse(row.config_json || '{}');
  const clientId = config.clientId || '';
  const apiSecret = config.apiSecret || '';
  db.close();

  const tokenRes = await fetch('https://api-sandbox.uqpaytech.com/api/v1/connect/token', { method: 'POST', headers: { 'x-client-id': clientId, 'x-api-key': apiSecret } });
  const tokenData: any = await tokenRes.json();
  const token = tokenData.auth_token;
  const EMAIL = 'pr45test@test.com';
  const CARD_PRODUCT_ID = '86445729-b385-42f2-92c3-3504ee9e81d0';

  // Step 1: check existing cardholder
  console.log('--- Step 1: check cardholder ---');
  let cardholderId: string | null = null;
  const chRes = await fetch('https://api-sandbox.uqpaytech.com/api/v1/issuing/cardholders?page_size=100&page_number=1', { headers: { 'x-auth-token': token } });
  if (chRes.ok) {
    const chData: any = await chRes.json();
    for (const ch of (chData.data || [])) {
      if (ch.email === EMAIL) { cardholderId = ch.cardholder_id; console.log('Found: '+cardholderId+' status='+ch.cardholder_status); break; }
    }
    if (!cardholderId) {
      for (const ch of (chData.data || [])) {
        if (ch.first_name === 'Test' && ch.last_name === 'User') { cardholderId = ch.cardholder_id; console.log('Found by name: '+cardholderId+' email='+ch.email+' phone='+ch.phone_number); break; }
      }
    }
  } else {
    console.log('List cardholders failed: '+chRes.status);
  }

  // Step 2: create cardholder (try multiple phone formats)
  if (!cardholderId) {
    console.log('--- Step 2: create cardholder ---');
    const attempts = [
      { phone: '13800000001', country: 'CN' },
      { phone: '8613800000001', country: 'CN' },
      { phone: '+8613800000001', country: 'CN' },
    ];
    for (const att of attempts) {
      const r = await fetch('https://api-sandbox.uqpaytech.com/api/v1/issuing/cardholders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': token, 'x-idempotency-key': randomUUID() },
        body: JSON.stringify({ first_name: 'Test', last_name: 'User', email: EMAIL, phone_number: att.phone, country_code: att.country, date_of_birth: '1990-01-01' })
      });
      if (r.ok) { const d: any = await r.json(); cardholderId = d.cardholder_id; console.log('Created: '+cardholderId+' phone='+att.phone+' country='+att.country); break; }
      else { const t = await r.text(); console.log('  failed phone='+att.phone+': status='+r.status); }
    }
  }
  if (!cardholderId) { console.log(JSON.stringify({error:'Could not create cardholder'})); return; }

  // Step 3: create card
  console.log('--- Step 3: create card ---');
  const cardRes = await fetch('https://api-sandbox.uqpaytech.com/api/v1/issuing/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token, 'x-idempotency-key': randomUUID() },
    body: JSON.stringify({ cardholder_id: cardholderId, card_product_id: CARD_PRODUCT_ID, card_currency: 'USD', card_limit: 100, usage_type: 'NORMAL' })
  });
  if (!cardRes.ok) { const ct = await cardRes.text(); console.log('Create card failed: '+cardRes.status+' '+ct.substring(0,200)); return; }
  const cardResult: any = await cardRes.json();
  console.log('Card: card_id='+cardResult.card_id+' card_status='+cardResult.card_status+' order_status='+cardResult.order_status+' last4='+cardResult.last4);

  // Step 4: verify with getCard
  console.log('--- Step 4: verify ---');
  const getCardRes = await fetch('https://api-sandbox.uqpaytech.com/api/v1/issuing/cards/'+cardResult.card_id, { headers: { 'x-auth-token': token } });
  if (!getCardRes.ok) { const ct = await getCardRes.text(); console.log('getCard failed: '+getCardRes.status+' '+ct.substring(0,200)); return; }
  const cd: any = await getCardRes.json();
  console.log('Verify: card_status='+cd.card_status+' balance='+cd.card_available_balance+' currency='+cd.currency+' card_limit='+cd.card_limit);
  if (cd.card_status !== 'ACTIVE') { console.log('ERROR: status='+cd.card_status+' not ACTIVE'); return; }
  console.log('SUCCESS: Card is ACTIVE');

  // Step 5: bind to user_id=13
  console.log('--- Step 5: bind to DB ---');
  const buf2 = fs.readFileSync(dbPath);
  const SQL2 = await initSqlJs();
  const db2 = new SQL.Database(buf2);
  const existing = db2.exec("SELECT id FROM cards WHERE external_id = '"+cardResult.card_id+"'");
  if (existing.length>0 && existing[0].values.length>0) {
    console.log('Already in DB: id='+existing[0].values[0][0]);
  } else {
    db2.run('INSERT INTO cards (user_id,channel_code,external_id,balance,currency,status,uqpay_cardholder_id,card_no_masked,card_type) VALUES(?,?,?,?,?,?,?,?,?)', [13,'UQPAY',cardResult.card_id,0,'USD',1,cardholderId,'**** **** **** '+(cardResult.last4||'0000'),'virtual']);
    fs.writeFileSync(dbPath,db2.export());
    console.log('Inserted OK');
  }
  db2.close();

  // Final check
  const buf3 = fs.readFileSync(dbPath);
  const SQL3 = await initSqlJs();
  const db3 = new SQL.Database(buf3);
  const ck = db3.exec("SELECT id,user_id,channel_code,external_id,balance,currency,status,card_no_masked FROM cards WHERE user_id=13 ORDER BY id DESC LIMIT 4");
  if (ck.length>0) { console.log('id|user_id|channel|external_id|balance|currency|status|masked'); ck[0].values.forEach((r:any)=>console.log(r.join('|'))); }
  db3.close();
}

main().catch(err => console.log('FATAL: '+err.message));
