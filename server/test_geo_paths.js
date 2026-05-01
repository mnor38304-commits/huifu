#!/usr/bin/env node
const { GeoSdk } = require('./dist/channels/geo');

const sdk = new GeoSdk({
  baseUrl: 'https://uat-openapi.geo.sh.cn',
  userNo: '2025730893061726465',
  appPublicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCB5OzcNz6k1jSHXvvWMR3uOAZ4CwniWdWIk7cQCmyrinQocpM/qiFUJX+MImrDQnAeQlBFlonPX2rWHfTbnW/E12wak9SZYOjJU/UF+iWLeXeX35Oa+d+JEd29ari7t5G3M+fibp06yDjL7X0WIl3XkHj+IbyH7UJfQeIx4jelvQIDAQAB',
  authMode: 'RSA_4_PARAMS',
});

const paths = [
  '/open-api/v1/account/balance',
  '/api/v1/account/balance',
  '/v1/account/balance',
  '/account/balance',
  '/open-api/v1/account/balances',
  '/api/v1/account/balances',
  '/open-api/v1/cards/bins',
  '/api/v1/cards/bins',
  '/v1/cards/bins',
  '/cards/bins',
  '/api/v1/accounts/balance',
  '/open-api/v1/account',
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
      console.log(`${resp.status} ${path}: ${text.slice(0, 120)}`);
      if (resp.status === 200) {
        console.log('>>> FOUND VALID PATH <<<');
      }
    } catch (err) {
      console.log(`ERR ${path}: ${err.message.slice(0, 60)}`);
    }
  }
}

test().catch(console.error);
