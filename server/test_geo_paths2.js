#!/usr/bin/env node
const { GeoSdk } = require('./dist/channels/geo');

const sdk = new GeoSdk({
  baseUrl: 'https://uat-openapi.geo.sh.cn',
  userNo: '2025730893061726465',
  appPublicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCB5OzcNz6k1jSHXvvWMR3uOAZ4CwniWdWIk7cQCmyrinQocpM/qiFUJX+MImrDQnAeQlBFlonPX2rWHfTbnW/E12wak9SZYOjJU/UF+iWLeXeX35Oa+d+JEd29ari7t5G3M+fibp06yDjL7X0WIl3XkHj+IbyH7UJfQeIx4jelvQIDAQAB',
  authMode: 'RSA_4_PARAMS',
});

const paths = [
  // /account/balance returned 200 with async:false, statusCode:500 - that's a valid encrypted response!
  // Let me try to decrypt it
  '/api/v1/account/balance',
  '/api/v1/account/balances',
  '/api/v1/cards/bins',
  '/api/v1/cards/create',
  '/api/v1/card/create',
  '/api/v1/createCard',
  '/api/v1/create-card',
  '/api/v1/card/issue',
  '/api/v1/cards',
  '/api/v1/card',
  '/account/balance',
  '/account/balances',
  '/accounts/balance',
  '/account/info',
  '/api/v1/user/info',
  '/api/v1/merchant/info',
  '/api/v1/merchant/balance',
];

async function test() {
  for (const path of paths) {
    try {
      const enc = sdk.encryptPayload({});
      const reqBody = {
        version: '1.0.0',
        userNo: '2025730893061726465',
        dataType: 'JSON',
        dataContent: enc,
      };
      const url = `https://uat-openapi.geo.sh.cn${path}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      const text = await resp.text();
      const snippet = text.slice(0, 200);
      console.log(`${resp.status} ${path}: ${snippet}`);
      if (resp.status === 200 && !text.includes('statusCode')) {
        console.log('>>> NO statusCode - might be clean data!');
        // Try to decrypt
        try {
          const parsed = JSON.parse(text);
          if (parsed.result) {
            const decrypted = sdk.decryptResponse(parsed.result);
            console.log('Decrypted:', JSON.stringify(decrypted));
          }
        } catch(e) {}
      }
    } catch (err) {
      console.log(`ERR ${path}: ${err.message.slice(0, 60)}`);
    }
  }
}

test().catch(console.error);
