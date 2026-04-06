import { Router } from 'express';
import db from '../db';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 确保必要的表存在
const ensureTables = () => {
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      balance_usd REAL DEFAULT 0,
      balance_usdt REAL DEFAULT 0,
      locked_usd REAL DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'USD',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    
    db.prepare(`CREATE TABLE IF NOT EXISTS usdt_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no VARCHAR(32) UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      amount_usdt REAL NOT NULL,
      amount_usd REAL NOT NULL,
      exchange_rate REAL NOT NULL,
      network VARCHAR(20) DEFAULT 'TRC20',
      pay_address VARCHAR(100) NOT NULL,
      tx_hash VARCHAR(100),
      status INTEGER DEFAULT 0,
      dogpay_order_id VARCHAR(100),
      expire_at DATETIME,
      confirmed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
  } catch (e) {
    console.error('[Wallet] ensureTables error:', e);
  }
};
ensureTables();

// 所有路由需要登录
router.use(authMiddleware);

// 获取当前用户ID的辅助函数
const getUserId = (req: any) => req.user?.userId;

// ── 获取用户钱包信息 ─────────────────────────────────────────
router.get('/info', (req, res) => {
  const userId = getUserId(req);

  // 获取或创建钱包
  let wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;

  if (!wallet) {
    // 创建钱包
    const result = db.prepare(`
      INSERT INTO wallets (user_id, balance_usd, balance_usdt, locked_usd, currency)
      VALUES (?, 0, 0, 0, 'USD')
    `).run(userId);
    wallet = {
      id: result.lastInsertRowid,
      user_id: userId,
      balance_usd: 0,
      balance_usdt: 0,
      locked_usd: 0,
      currency: 'USD'
    };
  }

  // 获取USD充值地址（通过DogPay）
  let usdtAddress = '';
  const addresses: Record<string, string> = {
    TRC20: 'TRx7NqmJHkFxyz1234567890abcdefghij',
    ERC20: '0xAbCdEf1234567890abcdef1234567890AbCdEf12',
    BEP20: '0xBnBAddr1234567890abcdef1234567890BnBAddr'
  };

  res.json({
    code: 0,
    data: {
      ...wallet,
      defaultAddress: addresses['TRC20']
    },
    timestamp: Date.now()
  });
});

// ── 获取充值地址 ─────────────────────────────────────────────
router.get('/address', async (req, res) => {
  const userId = getUserId(req);
  const { network = 'TRC20' } = req.query;

  const addresses: Record<string, string> = {
    TRC20: 'TRx7NqmJHkFxyz1234567890abcdefghij',
    ERC20: '0xAbCdEf1234567890abcdef1234567890AbCdEf12',
    BEP20: '0xBnBAddr1234567890abcdef1234567890BnBAddr'
  };

  const address = addresses[network as string] || addresses['TRC20'];

  // 尝试从DogPay获取真实地址
  try {
    const { DogPaySDK } = await import('../channels/dogpay');
    const channel = db.prepare("SELECT * FROM card_channels WHERE channel_code = 'dogpay' AND status = 1").get() as any;
    if (channel) {
      const sdk = new DogPaySDK({
        appId: channel.api_key,
        appSecret: channel.api_secret,
        apiBaseUrl: channel.api_base_url
      });

      const chainMap: Record<string, string> = {
        TRC20: 'trx',
        ERC20: 'eth',
        BEP20: 'bnb'
      };

      const result = await sdk.getDepositAddress({ chain: chainMap[network as string] || 'trx' });
      if (result?.data?.address) {
        return res.json({
          code: 0,
          data: {
            address: result.data.address,
            network: network,
            qrCode: result.data.qrCode || ''
          },
          timestamp: Date.now()
        });
      }
    }
  } catch (err: any) {
    console.error('[Wallet] getDepositAddress error:', err.message);
  }

  res.json({
    code: 0,
    data: {
      address,
      network: network,
      qrCode: ''
    },
    timestamp: Date.now()
  });
});

// ── 获取充值订单列表 ─────────────────────────────────────────
router.get('/deposits', (req, res) => {
  const userId = getUserId(req);
  const { page = 1, pageSize = 20 } = req.query;

  const offset = (Number(page) - 1) * Number(pageSize);
  const list = db.prepare(`
    SELECT * FROM usdt_orders
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, Number(pageSize), offset);

  const total = (db.prepare('SELECT COUNT(*) as c FROM usdt_orders WHERE user_id = ?').get(userId) as any).c;

  res.json({
    code: 0,
    data: { list, total, page: Number(page), pageSize: Number(pageSize) },
    timestamp: Date.now()
  });
});

// ── 创建充值订单（C2C买币）───────────────────────────────────
router.post('/deposit/c2c', async (req, res) => {
  const userId = getUserId(req);
  
  console.log('[Wallet] createC2COrder - userId:', userId, 'body:', req.body);
  
  if (!userId) {
    return res.json({ code: 401, message: '用户未登录' });
  }

  const { amountUsdt, network = 'TRC20' } = req.body;

  if (!amountUsdt || amountUsdt <= 0) {
    return res.json({ code: 400, message: '请输入有效的充值金额' });
  }

  const exchangeRate = 1.0;
  const amountUsd = amountUsdt * exchangeRate;
  const orderNo = `DP${Date.now()}${Math.floor(Math.random() * 1000)}`;

  // 尝试通过DogPay创建C2C订单
  let payAddress = '';
  let dogpayOrderId = '';

  try {
    const { DogPaySDK } = await import('../channels/dogpay');
    const channel = db.prepare("SELECT * FROM card_channels WHERE channel_code = 'dogpay' AND status = 1").get() as any;
    if (channel) {
      const sdk = new DogPaySDK({
        appId: channel.api_key,
        appSecret: channel.api_secret,
        apiBaseUrl: channel.api_base_url
      });

      const chainMap: Record<string, string> = {
        TRC20: 'trx',
        ERC20: 'eth',
        BEP20: 'bnb'
      };

      const result = await sdk.createC2COrder({
        amount: amountUsdt,
        token: 'USDT',
        network: chainMap[network as string] || 'trx'
      });

      if (result?.data) {
        payAddress = result.data.payAddress || '';
        dogpayOrderId = result.data.orderId || '';
      }
    }
  } catch (err: any) {
    console.error('[Wallet] createC2COrder error:', err.message);
  }

  // 如果没有获取到地址，使用备用地址
  if (!payAddress) {
    const addresses: Record<string, string> = {
      TRC20: 'TRx7NqmJHkFxyz1234567890abcdefghij',
      ERC20: '0xAbCdEf1234567890abcdef1234567890AbCdEf12',
      BEP20: '0xBnBAddr1234567890abcdef1234567890BnBAddr'
    };
    payAddress = addresses[network as string] || addresses['TRC20'];
  }

  const expireAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const result = db.prepare(`
    INSERT INTO usdt_orders (order_no, user_id, amount_usdt, amount_usd, exchange_rate, network, pay_address, status, dogpay_order_id, expire_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(orderNo, userId, amountUsdt, amountUsd, exchangeRate, network, payAddress, dogpayOrderId || null, expireAt);

  res.json({
    code: 0,
    data: {
      orderId: result.lastInsertRowid,
      orderNo,
      amountUsdt,
      amountUsd,
      exchangeRate,
      network,
      payAddress,
      expireAt
    },
    timestamp: Date.now()
  });
});

// ── 获取充值订单详情 ─────────────────────────────────────────
router.get('/deposits/:id', (req, res) => {
  const userId = getUserId(req);
  const order = db.prepare('SELECT * FROM usdt_orders WHERE id = ? AND user_id = ?').get(req.params.id, userId);

  if (!order) {
    return res.json({ code: 404, message: '订单不存在' });
  }

  res.json({ code: 0, data: order, timestamp: Date.now() });
});

// ── 获取钱包流水记录 ─────────────────────────────────────────
router.get('/records', (req, res) => {
  const userId = getUserId(req);
  const { page = 1, pageSize = 20, type } = req.query;

  let whereClause = 'WHERE user_id = ?';
  const params: any[] = [userId];

  if (type) {
    whereClause += ' AND type = ?';
    params.push(type);
  }

  const offset = (Number(page) - 1) * Number(pageSize);
  const list = db.prepare(`
    SELECT * FROM wallet_records
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM wallet_records ${whereClause}`).get(...params) as any).c;

  res.json({
    code: 0,
    data: { list, total, page: Number(page), pageSize: Number(pageSize) },
    timestamp: Date.now()
  });
});

// ── 获取钱包统计 ─────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const userId = getUserId(req);

  // 获取钱包余额
  let wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;
  if (!wallet) {
    db.prepare('INSERT INTO wallets (user_id, balance_usd, balance_usdt, locked_usd, currency) VALUES (?, 0, 0, 0, ?)').run(userId, 'USD');
    wallet = { balance_usd: 0, balance_usdt: 0, locked_usd: 0 };
  }

  // 获取今日充值
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayDeposit = db.prepare(`
    SELECT COALESCE(SUM(amount_usd), 0) as total
    FROM usdt_orders
    WHERE user_id = ? AND status >= 1 AND created_at >= ?
  `).get(userId, todayStart.toISOString()) as any;

  // 获取本月充值
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthDeposit = db.prepare(`
    SELECT COALESCE(SUM(amount_usd), 0) as total
    FROM usdt_orders
    WHERE user_id = ? AND status >= 1 AND created_at >= ?
  `).get(userId, monthStart.toISOString()) as any;

  res.json({
    code: 0,
    data: {
      balanceUsd: wallet.balance_usd,
      balanceUsdt: wallet.balance_usdt,
      lockedUsd: wallet.locked_usd,
      todayDeposit: todayDeposit?.total || 0,
      monthDeposit: monthDeposit?.total || 0
    },
    timestamp: Date.now()
  });
});

export default router;
