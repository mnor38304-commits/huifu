/**
 * 简单的 DogPay 配置脚本
 * 直接修改环境变量文件
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

console.log('🚀 DogPay 配置脚本\n');

// 读取现有 .env 文件
let envContent = '';
if (fs.existsSync(ENV_PATH)) {
  envContent = fs.readFileSync(ENV_PATH, 'utf-8');
  console.log('📂 读取现有 .env 文件');
} else {
  console.log('📂 创建新的 .env 文件');
}

// 添加 DogPay 配置
const dogpayConfig = `
# DogPay 支付渠道配置
DOGPAY_API_KEY=2029791977437134849
DOGPAY_API_SECRET=WgCo4HShHRLVBYmeJH5wT9IkkYZilxR4
DOGPAY_API_URL=https://api.dogpay.com
DOGPAY_CHANNEL_CODE=dogpay
`;

// 检查是否已存在 DogPay 配置
if (envContent.includes('DOGPAY_API_KEY')) {
  // 更新现有配置
  envContent = envContent.replace(
    /DOGPAY_API_KEY=.*/g,
    'DOGPAY_API_KEY=2029791977437134849'
  );
  envContent = envContent.replace(
    /DOGPAY_API_SECRET=.*/g,
    'DOGPAY_API_SECRET=WgCo4HShHRLVBYmeJH5wT9IkkYZilxR4'
  );
  console.log('🔄 更新现有 DogPay 配置');
} else {
  // 添加新配置
  envContent += dogpayConfig;
  console.log('➕ 添加 DogPay 配置');
}

// 写入文件
fs.writeFileSync(ENV_PATH, envContent);
console.log('✅ 配置已保存到:', ENV_PATH);

console.log('\n📋 配置内容:');
console.log('─'.repeat(50));
console.log('DOGPAY_API_KEY=2029791977437134849');
console.log('DOGPAY_API_SECRET=WgCo4HShHRLVBYmeJH5wT9IkkYZilxR4');
console.log('DOGPAY_API_URL=https://api.dogpay.com');
console.log('─'.repeat(50));

console.log('\n📝 下一步:');
console.log('   1. 确保 .env 文件中的配置正确');
console.log('   2. 启动服务器: npm run dev');
console.log('   3. 使用管理后台或 API 配置渠道');
console.log('   4. 调用 POST /api/admin/card-channels/dogpay/sync-bins 同步卡 BIN');

console.log('\n⚠️  注意: 数据库中的渠道配置需要通过 API 或 SQL 手动添加');
console.log('   SQL 文件已生成: scripts/dogpay-config.sql');
