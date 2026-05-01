#!/usr/bin/env node
const { GeoSdk } = require('./dist/channels/geo');

const sdk = new GeoSdk({
  baseUrl: 'https://uat-openapi.geo.sh.cn',
  userNo: '2025730893061726465',
  appPublicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCB5OzcNz6k1jSHXvvWMR3uOAZ4CwniWdWIk7cQCmyrinQocpM/qiFUJX+MImrDQnAeQlBFlonPX2rWHfTbnW/E12wak9SZYOjJU/UF+iWLeXeX35Oa+d+JEd29ari7t5G3M+fibp06yDjL7X0WIl3XkHj+IbyH7UJfQeIx4jelvQIDAQAB',
});

async function test() {
  console.log('=== Testing /account/balance ===');
  try {
    const result = await sdk.getAccountBalance();
    console.log('Available:', result.availableBalance);
    console.log('Pending:', result.pendingBalance);
    console.log('Raw (sanitized):', JSON.stringify(sdk.sanitizeLog(result.rawJson)).slice(0, 500));
  } catch (err) {
    console.error('SDK Error:', err.message);
  }
  
  // Also test /cards/bins
  console.log('\n=== Testing /cards/bins ===');
  try {
    const bins = await sdk.listBins();
    console.log('Bins count:', bins.length);
    console.log('First bin (sanitized):', JSON.stringify(sdk.sanitizeLog(bins[0])).slice(0, 300));
  } catch (err) {
    console.error('Bins Error:', err.message);
  }
}

test().catch(console.error);
