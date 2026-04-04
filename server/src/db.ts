import initSqlJs, { Database } from 'sql.js';
import path from 'path';
import fs from 'fs';

let db: Database | null = null;
const DB_PATH = process.env.DB_PATH || './data/vcc.db';

export async function initDatabase(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  // ── 商户用户表 ──────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_no VARCHAR(32) UNIQUE NOT NULL,
    phone VARCHAR(20), email VARCHAR(100),
    password_hash VARCHAR(255) NOT NULL, salt VARCHAR(64) NOT NULL,
    status INTEGER DEFAULT 1,   -- 1正常 2禁用
    kyc_status INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── KYC 认证表 ───────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS kyc_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, subject_type INTEGER NOT NULL,
    real_name VARCHAR(100) NOT NULL, id_number VARCHAR(50) NOT NULL,
    id_type INTEGER NOT NULL,
    id_front_url VARCHAR(500), id_back_url VARCHAR(500), id_hold_url VARCHAR(500),
    id_expire_date DATE, status INTEGER DEFAULT 0,
    reject_reason VARCHAR(500), auditor_id INTEGER, audited_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── 卡 BIN 表 ────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS card_bins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bin_code VARCHAR(10) UNIQUE NOT NULL,   -- 卡BIN前6位
    bin_name VARCHAR(100) NOT NULL,         -- BIN名称
    card_brand VARCHAR(20) DEFAULT 'VISA',  -- VISA/MC
    issuer VARCHAR(100),                    -- 发卡机构
    currency VARCHAR(3) DEFAULT 'USD',
    country VARCHAR(50) DEFAULT 'US',
    status INTEGER DEFAULT 1,              -- 1启用 0禁用
    -- 费率配置
    open_fee REAL DEFAULT 0,               -- 开卡费 USD
    topup_fee_rate REAL DEFAULT 0.015,     -- 充值手续费率
    topup_fee_min REAL DEFAULT 0,          -- 充值最低手续费
    cross_border_fee_rate REAL DEFAULT 0.015, -- 跨境手续费率
    small_txn_threshold REAL DEFAULT 1,    -- 小额交易阈值
    small_txn_fee REAL DEFAULT 0.1,        -- 小额交易手续费
    decline_fee REAL DEFAULT 0.5,          -- 余额不足拒绝手续费
    auth_fee REAL DEFAULT 0,               -- 授权手续费
    refund_fee_rate REAL DEFAULT 0,        -- 退款手续费率
    monthly_fee REAL DEFAULT 1.0,          -- 月费
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── 卡片表（关联BIN）────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_no VARCHAR(50) NOT NULL, card_no_masked VARCHAR(20) NOT NULL,
    user_id INTEGER NOT NULL, bin_id INTEGER,
    card_name VARCHAR(100) NOT NULL, card_type VARCHAR(20) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    balance REAL DEFAULT 0, credit_limit REAL NOT NULL,
    single_limit REAL, daily_limit REAL,
    status INTEGER DEFAULT 1,  -- 1正常 2冻结 3过期 4注销 0待激活
    expire_date DATE NOT NULL, cvv VARCHAR(10) NOT NULL,
    purpose VARCHAR(100),
    external_id VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bin_id) REFERENCES card_bins(id)
  )`);

  // ── 交易流水表 ───────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txn_no VARCHAR(32) UNIQUE NOT NULL,
    card_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    txn_type VARCHAR(20) NOT NULL,
    amount REAL NOT NULL, fee REAL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'USD',
    status INTEGER DEFAULT 0,  -- 0处理中 1成功 2失败 3撤销
    merchant_name VARCHAR(200), merchant_category VARCHAR(50),
    auth_code VARCHAR(20), reference_no VARCHAR(50),
    txn_time DATETIME NOT NULL, settled_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES cards(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── 账单表 ───────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, month VARCHAR(7) NOT NULL,
    total_spend REAL DEFAULT 0, total_topup REAL DEFAULT 0,
    total_fee REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, month)
  )`);

  // ── 公告表 ───────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title VARCHAR(200) NOT NULL, content TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'system',
    status INTEGER DEFAULT 1, top INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── 管理员表 ─────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL, salt VARCHAR(64) NOT NULL,
    real_name VARCHAR(100),
    role VARCHAR(20) DEFAULT 'operator',  -- super/admin/operator/finance
    status INTEGER DEFAULT 1,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── USDT 充值订单表 ──────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS usdt_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no VARCHAR(32) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    amount_usdt REAL NOT NULL,       -- USDT金额
    amount_usd REAL NOT NULL,        -- 折算USD金额
    exchange_rate REAL NOT NULL,     -- 汇率
    network VARCHAR(20) DEFAULT 'TRC20',  -- TRC20/ERC20/BEP20
    pay_address VARCHAR(100) NOT NULL,    -- 收款地址
    tx_hash VARCHAR(100),            -- 链上交易hash
    status INTEGER DEFAULT 0,        -- 0待支付 1已支付 2已确认 3已过期 4失败
    expire_at DATETIME,
    confirmed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // ── 卡渠道对接配置表 ─────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS card_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_code VARCHAR(50) UNIQUE NOT NULL,  -- 渠道代码
    channel_name VARCHAR(100) NOT NULL,        -- 渠道名称
    api_base_url VARCHAR(500),                 -- API基础URL
    api_key VARCHAR(500),                      -- API Key (加密存储)
    api_secret VARCHAR(500),                   -- API Secret
    webhook_secret VARCHAR(200),               -- Webhook验签密钥
    status INTEGER DEFAULT 1,
    config_json TEXT,                          -- 额外配置JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── 操作日志表 ───────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER, admin_name VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50), target_id INTEGER,
    detail TEXT, ip VARCHAR(50),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── 系统配置表 ───────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS system_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT NOT NULL,
    description VARCHAR(200),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_users_user_no ON users(user_no)');
    db.run('CREATE INDEX IF NOT EXISTS idx_cards_user_id ON cards(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_transactions_card_id ON transactions(card_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_usdt_orders_user_id ON usdt_orders(user_id)');
  } catch (e) {}

  saveDatabase();
  console.log('✅ Database initialized');
  return db;
}

export function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function getDb(): Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export default {
  prepare: (sql: string) => {
    const database = getDb();
    return {
      run: (...params: any[]) => {
        database.run(sql, params);
        saveDatabase();
        const r = database.exec('SELECT last_insert_rowid() as id');
        return { lastInsertRowid: r[0]?.values[0]?.[0] || 0 };
      },
      get: (...params: any[]) => {
        const stmt = database.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row: any = {};
          cols.forEach((c, i) => { row[c] = vals[i]; });
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all: (...params: any[]) => {
        const stmt = database.prepare(sql);
        stmt.bind(params);
        const results: any[] = [];
        const cols = stmt.getColumnNames();
        while (stmt.step()) {
          const vals = stmt.get();
          const row: any = {};
          cols.forEach((c, i) => { row[c] = vals[i]; });
          results.push(row);
        }
        stmt.free();
        return results;
      }
    };
  }
};
