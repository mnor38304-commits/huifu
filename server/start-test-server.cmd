@echo off
set DB_PATH=data\test-vcc.db
set JWT_SECRET=test-jwt-secret-for-integration-test
set ENABLE_WALLET_CONVERT=true
set WALLET_CONVERT_TEST_USER_IDS=1
set USDT_TO_USD_RATE=1.0
set PORT=3099
set ENABLE_UQPAY_REAL_RECHARGE=false
set UQPAY_RECHARGE_TEST_USER_IDS=
set ALLOWED_ORIGINS=*
cd /d "%~dp0"
echo Starting test server on port 3099...
npx tsx src/index.ts
