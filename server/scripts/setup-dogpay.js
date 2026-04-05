/**
 * DogPay 渠道配置脚本
 * 
 * 使用方法:
 * node scripts/setup-dogpay.js --api-key=xxx --api-secret=yyy [--api-url=https://api.dogpay.com]
 */

const fs = require('fs');
const path = require('path');

// 解析命令行参数
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value || true;
    }
  });
  return args;
}

const args = parseArgs();

// 帮助信息
if (args.help || args.h) {
  console.log(`
DogPay 渠道配置脚本

用法:
  node scripts/setup-dogpay.js --api-key=<key> --api-secret=<secret> [选项]

必需参数:
  --api-key       DogPay API Key
  --api-secret    DogPay API Secret

可选参数:
  --api-url       API 基础 URL (默认: https://api.dogpay.com)
  --webhook-secret Webhook 验签密钥
  --status        渠道状态: 1=启用, 0=禁用 (默认: 1)

示例:
  node scripts/setup-dogpay.js --api-key=dp_123456 --api-secret=sec_abcdef
`);
  process.exit(0);
}

// 验证必需参数
if (!args['api-key'] || !args['api-secret']) {
  console.error('❌ 错误: 缺少必需参数 --api-key 和 --api-secret');
  console.error('使用 --help 查看帮助信息');
  process.exit(1);
}

const config = {
  channelCode: 'dogpay',
  channelName: 'DogPay 虚拟卡',
  apiBaseUrl: args['api-url'] || 'https://api.dogpay.com',
  apiKey: args['api-key'],
  apiSecret: args['api-secret'],
  webhookSecret: args['webhook-secret'] || '',
  status: parseInt(args['status'] || '1', 10)
};

console.log('\n📝 DogPay 配置信息:');
console.log(`   渠道名称: ${config.channelName}`);
console.log(`   API URL: ${config.apiBaseUrl}`);
console.log(`   API Key: ${config.apiKey.substring(0, 6)}...${config.apiKey.slice(-4)}`);
console.log(`   API Secret: ${config.apiSecret ? '已设置' : '未设置'}`);
console.log(`   状态: ${config.status === 1 ? '启用' : '禁用'}`);

// 生成 SQL
const sql = `
-- DogPay 渠道配置
INSERT INTO card_channels (
  channel_code,
  channel_name,
  api_base_url,
  api_key,
  api_secret,
  webhook_secret,
  status,
  config_json
) VALUES (
  '${config.channelCode}',
  '${config.channelName}',
  '${config.apiBaseUrl}',
  '${config.apiKey}',
  '${config.apiSecret}',
  '${config.webhookSecret}',
  ${config.status},
  '{}'
)
ON CONFLICT(channel_code) DO UPDATE SET
  channel_name = excluded.channel_name,
  api_base_url = excluded.api_base_url,
  api_key = excluded.api_key,
  api_secret = excluded.api_secret,
  webhook_secret = excluded.webhook_secret,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;
`;

// 保存 SQL 文件
const sqlPath = path.join(__dirname, 'dogpay-config.sql');
fs.writeFileSync(sqlPath, sql);

console.log(`\n✅ SQL 配置已生成: ${sqlPath}`);
console.log('\n📋 下一步:');
console.log('   1. 在数据库中执行上述 SQL');
console.log('   2. 重启服务器应用配置');
console.log('   3. 调用 API 同步 DogPay 卡 BIN: POST /api/admin/card-channels/dogpay/sync-bins');
console.log('   4. 配置商户可开通的卡段');

// 同时输出环境变量配置
console.log('\n🔧 环境变量配置 (可选):');
console.log(`   DOGPAY_API_KEY=${config.apiKey}`);
console.log(`   DOGPAY_API_SECRET=${config.apiSecret}`);
console.log(`   DOGPAY_API_URL=${config.apiBaseUrl}`);
