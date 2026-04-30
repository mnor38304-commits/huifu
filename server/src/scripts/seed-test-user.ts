/**
 * 种子脚本：为本地集成测试创建一个测试用户。
 *
 * 用法：tsx server/src/scripts/seed-test-user.ts
 *
 * 前提条件：必须先运行"npm run build"或该目录下已经有编译好的文件。
 * 实际路径基于 server/ 下的 db.ts / node_modules。
 */
import path from 'path';

// 确保 process.chdir 到 server 目录
const serverDir = path.resolve(__dirname, '..', '..');
process.chdir(serverDir);
console.log('[Seed] CWD:', process.cwd());

// 设置测试 DB 路径
process.env.DB_PATH = './data/test-vcc.db';
process.env.JWT_SECRET = 'test-jwt-secret-for-integration-test';

async function main() {
  const { initDatabase, getDb, default: db } = await import('../db');

  // 初始化数据库（创建表结构）
  await initDatabase();

  // tsx 模式下需要动态 require bcryptjs
  const bcrypt = require('bcryptjs');

  // 生成已知密码的哈希
  const password = 'test123';
  const salt = bcrypt.genSaltSync(12);
  const hash = bcrypt.hashSync(password, salt);

  // 检查用户是否已存在
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('test@test.com') as any;
  if (existing) {
    console.log('[Seed] 测试用户已存在，ID:', existing.id);
    // 确保钱包有 USDT
    const wallet = db.prepare('SELECT id, balance_usdt FROM wallets WHERE user_id = ?').get(existing.id) as any;
    if (wallet) {
      db.prepare('UPDATE wallets SET balance_usdt = 100, balance_usd = 10 WHERE user_id = ?').run(existing.id);
      console.log('[Seed] 钱包已更新 USDT=100, USD=10');
    } else {
      db.prepare('INSERT INTO wallets (user_id, balance_usd, balance_usdt) VALUES (?, 10, 100)').run(existing.id);
      console.log('[Seed] 钱包已创建 USDT=100, USD=10');
    }
    console.log('[Seed] 用户 ID:', existing.id);
    return existing.id;
  }

  // 插入测试用户
  const userNo = `TEST${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}001`;
  const result = db.prepare(`
    INSERT INTO users (user_no, phone, email, password_hash, salt, status, kyc_status)
    VALUES (?, ?, ?, ?, ?, 1, 0)
  `).run(userNo, null, 'test@test.com', hash, salt);

  const userId = result.lastInsertRowid as number;
  console.log('[Seed] 用户已创建，ID:', userId, '密码:', password);

  // 创建钱包并注入 USDT 余额
  db.prepare('INSERT INTO wallets (user_id, balance_usd, balance_usdt) VALUES (?, 10, 100)').run(userId);
  console.log('[Seed] 钱包已创建 USDT=100, USD=10');

  return userId;
}

main()
  .then((userId) => {
    console.log('[Seed] ✅ 种子数据就绪，用户 ID:', userId);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Seed] ❌ 种子脚本失败:', err);
    process.exit(1);
  });
