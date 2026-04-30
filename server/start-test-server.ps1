$env:DB_PATH='data/test-vcc.db'
$env:JWT_SECRET='test-jwt-secret-for-integration-test'
$env:ENABLE_WALLET_CONVERT='true'
$env:WALLET_CONVERT_TEST_USER_IDS='1'
$env:USDT_TO_USD_RATE='1.0'
$env:PORT='3099'
$env:ENABLE_UQPAY_REAL_RECHARGE='false'
$env:UQPAY_RECHARGE_TEST_USER_IDS=''
$env:ALLOWED_ORIGINS='*'
$env:NODE_ENV='development'

Write-Output "Starting test server on port 3099..."
npx tsx src/index.ts
