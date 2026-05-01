import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data/vcc.db');
  const buf = fs.readFileSync(dbPath);
  const SQL = await initSqlJs();
  const db = new SQL.Database(buf);

  const rows = db.exec("SELECT * FROM card_channels WHERE UPPER(channel_code) = 'UQPAY' AND status = 1");
  if (!rows.length || !rows[0].values.length) throw new Error('UQPAY channel not found');

  const cols = rows[0].columns;
  const vals = rows[0].values[0];
  const row: any = {};
  cols.forEach((c: string, i: number) => { row[c] = vals[i]; });
  const config = JSON.parse(row.config_json || '{}');

  db.close();

  // Direct token
  const tokenRes = await fetch('https://api-sandbox.uqpaytech.com/api/v1/connect/token', {
    method: 'POST',
    headers: { 'x-client-id': config.clientId || '', 'x-api-key': config.apiSecret || '' }
  });
  const tokenData: any = await tokenRes.json();
  const token = tokenData.auth_token;

  // Get all products
  const prodRes = await fetch('https://api-sandbox.uqpaytech.com/api/v1/issuing/products?page_size=100&page_number=1', {
    headers: { 'x-auth-token': token }
  });
  const prodData: any = await prodRes.json();

  console.log('=== ALL Products ===');
  (prodData.data || []).forEach((p: any, i: number) => {
    console.log(`Product ${i+1}:`);
    console.log(JSON.stringify({
      product_id: p.product_id,
      name: p.name,
      card_currency: p.card_currency,
      card_form: p.card_form,
      card_scheme: p.card_scheme,
      mode_type: p.mode_type,
      kyc_level: p.kyc_level,
      max_card_quota: p.max_card_quota,
      product_status: p.product_status,
      no_pin_payment_amount: p.no_pin_payment_amount,
      required_fields: p.required_fields,
    }, null, 2));
    console.log('');
  });
}

main().catch(err => console.log('FATAL:', err.message));
