#!/usr/bin/env node
const { GeoSdk } = require('./dist/channels/geo');

const sdk = new GeoSdk({
  baseUrl: 'https://uat-openapi.geo.sh.cn',
  userNo: '2025730893061726465',
  appPublicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCB5OzcNz6k1jSHXvvWMR3uOAZ4CwniWdWIk7cQCmyrinQocpM/qiFUJX+MImrDQnAeQlBFlonPX2rWHfTbnW/E12wak9SZYOjJU/UF+iWLeXeX35Oa+d+JEd29ari7t5G3M+fibp06yDjL7X0WIl3XkHj+IbyH7UJfQeIx4jelvQIDAQAB',
  authMode: 'RSA_4_PARAMS',
});

async function test() {
  console.log('=== Testing RSA encryption... ===');
  const testPayload = { test: 'hello' };
  const encrypted = sdk.encryptPayload(testPayload);
  console.log('Encrypted length:', encrypted.length);
  console.log('Encrypted (first 100):', encrypted.slice(0, 100));

  const requestBody = {
    version: '1.0.0',
    userNo: '2025730893061726465',
    dataType: 'JSON',
    dataContent: encrypted,
  };
  console.log('\nFull request body:', JSON.stringify(requestBody, null, 2).slice(0, 200));

  console.log('\n=== Calling balance API... ===');
  try {
    const response = await fetch('https://uat-openapi.geo.sh.cn/open-api/v1/account/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const status = response.status;
    const text = await response.text();
    console.log('Status:', status);
    console.log('Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));
    console.log('Response body:', text.slice(0, 1000));
  } catch (err) {
    console.error('Balance API error:', err.message);
  }

  console.log('\n=== Calling bins API... ===');
  try {
    const enc2 = sdk.encryptPayload({});
    const req2 = {
      version: '1.0.0',
      userNo: '2025730893061726465',
      dataType: 'JSON',
      dataContent: enc2,
    };
    const response2 = await fetch('https://uat-openapi.geo.sh.cn/open-api/v1/cards/bins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req2),
    });
    const status2 = response2.status;
    const text2 = await response2.text();
    console.log('Status:', status2);
    console.log('Response body:', text2.slice(0, 1000));
  } catch (err) {
    console.error('Bins API error:', err.message);
  }
}

test().catch(console.error);
