/**
 * 初始化 DogPay 数据库配置
 * 使用 sql.js 直接操作 SQLite 数据库
 */

import * as fs from 'fs';
import * as path from 'path';
import initSqlJs from 'sql.js';

const DB_PATH = path.join(__dirname, '..', 'data', 'vcc.db');

async function main() {
  console.log('🚀 初始化 DogPay 配置...\n');

  // 确保数据目录存在
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 创建数据目录:', dataDir);
  }

  // 初始化 SQL.js
  const SQL = await initSqlJs();

  // 加载或创建数据库
  let db: any;
  if (fs.existsSync(DB_PATH)) {
    const filebuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(filebuffer);
    console.log('📂 加载现有数据库');
  } else {
    db = new SQL.Database();
    console.log('📂 创建新数据库');
  }

  try {
    // 创建 card_channels 表（如果不存在）
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS card_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_code TEXT UNIQUE NOT NULL,
        channel_name TEXT NOT NULL,
        api_base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        api_secret TEXT NOT NULL,
        webhook_secret TEXT DEFAULT '',
        status INTEGER DEFAULT 1,
        config_json TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `;
    db.run(createTableSQL);
    console.log('✅ 确保 card_channels 表存在');

    // 插入或更新 DogPay 配置
    const insertSQL = `
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
        'dogpay',
        'DogPay 虚拟卡',
        'https://api.dogpay.com',
        '2029791977437134849',
        'WgCo4HShHRLVBYmeJH5wT9IkkYZilxR4',
        '',
        1,
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
    db.run(insertSQL);
    console.log('✅ DogPay 渠道配置已保存');

    // 验证配置
    const result = db.exec("SELECT channel_code, channel_name, status FROM card_channels WHERE channel_code = 'dogpay'");
    if (result.length > 0 && result[0].values.length > 0) {
      const row = result[0].values[0];
      console.log('\n📋 配置信息:');
      console.log(`   渠道代码: ${row[0]}`);
      console.log(`   渠道名称: ${row[1]}`);
      console.log(`   状态: ${row[2] === 1 ? '启用' : '禁用'}`);
    }

    // 保存数据库到文件
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    console.log('\n💾 数据库已保存到:', DB_PATH);

    console.log('\n🎉 DogPay 配置完成！');
    console.log('\n📌 下一步:');
    console.log('   1. 启动服务器: npm run dev');
    console.log('   2. 登录管理后台');
    console.log('   3. 调用 API 同步卡 BIN: POST /api/admin/card-channels/dogpay/sync-bins');

  } catch (error) {
    console.error('❌ 错误:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
