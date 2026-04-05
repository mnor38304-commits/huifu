/**
 * 应用 DogPay 配置到数据库
 */

const fs = require('fs');
const path = require('path');

// 读取 SQL 文件
const sqlFile = path.join(__dirname, 'dogpay-config.sql');
const sql = fs.readFileSync(sqlFile, 'utf-8');

console.log('📝 正在应用 DogPay 配置...\n');
console.log('SQL 内容:');
console.log('─'.repeat(60));
console.log(sql);
console.log('─'.repeat(60));
console.log('\n✅ SQL 文件已生成: scripts/dogpay-config.sql');
console.log('\n📋 请手动执行以下操作:');
console.log('   1. 启动服务器: npm run dev');
console.log('   2. 使用 API 或数据库工具执行上述 SQL');
console.log('   3. 调用同步卡 BIN API: POST /api/admin/card-channels/dogpay/sync-bins');
