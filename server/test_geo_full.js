#!/usr/bin/env node
const { GeoSdk } = require('./dist/channels/geo');

const sdk = new GeoSdk({
  baseUrl: 'https://uat-openapi.geo.sh.cn',
  userNo: '2025730893061726465',
  appPublicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCB5OzcNz6k1jSHXvvWMR3uOAZ4CwniWdWIk7cQCmyrinQocpM/qiFUJX+MImrDQnAeQlBFlonPX2rWHfTbnW/E12wak9SZYOjJU/UF+iWLeXeX35Oa+d+JEd29ari7t5G3M+fibp06yDjL7X0WIl3XkHj+IbyH7UJfQeIx4jelvQIDAQAB',
  authMode: 'RSA_4_PARAMS',
});

async function test() {
  // Let me decode the /account/balance response
  // The response was: {"async":false,"statusCode":500}
  // But our decryptResponse expects a hex "result" field
  // Let me get the full response
  
  const enc = sdk.encryptPayload({});
  const reqBody = {
    version: '1.0.0',
    userNo: '2025730893061726465',
    dataType: 'JSON',
    dataContent: enc,
  };
  
  console.log('=== Test /account/balance with full response ===');
  const resp = await fetch('https://uat-openapi.geo.sh.cn/account/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  const text = await resp.text();
  const headers = Object.fromEntries(resp.headers.entries());
  console.log('Status:', resp.status);
  console.log('Headers:', JSON.stringify(headers, null, 2));
  console.log('Body:', text);
  
  // Parse and try to decrypt
  try {
    const parsed = JSON.parse(text);
    if (parsed.result) {
      console.log('\nHas result field, length:', parsed.result.length);
      const decrypted = sdk.decryptResponse(parsed.result);
      console.log('Decrypted:', JSON.stringify(decrypted, null, 2));
    }
    if (parsed.data) {
      console.log('Has data field:', parsed.data);
    }
  } catch(e) {
    console.log('Parse error:', e.message);
  }

  // Now try with different payload content
  console.log('\n=== Test with payload { merchantNo: userNo } ===');
  const enc2 = sdk.encryptPayload({ merchantNo: '2025730893061726465' });
  const reqBody2 = {
    version: '1.0.0',
    userNo: '2025730893061726465',
    dataType: 'JSON',
    dataContent: enc2,
  };
  const resp2 = await fetch('https://uat-openapi.geo.sh.cn/account/balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody2),
  });
  const text2 = await resp2.text();
  console.log('Status:', resp2.status, 'Body:', text2.slice(0, 500));
  try {
    const p2 = JSON.parse(text2);
    if (p2.result) {
      console.log('Decrypted 2:', JSON.stringify(sdk.decryptResponse(p2.result), null, 2));
    }
  } catch(e) {}
}

test().catch(console.error);
