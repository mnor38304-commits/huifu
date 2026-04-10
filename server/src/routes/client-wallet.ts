import { Router } from 'express';
import db, { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// ── 迁移函数 ────────────────────────────────────────────────────────────────

export const initWalletTables = () => {
  try {
    const database = getDb();

    // 迁移：为 usdt_orders 表添加 dogpay_order_id 列
    try {
      database.run(`ALTER TABLE usdt_orders ADD COLUMN dogpay_order_id VARCHAR(100)`);
    } catch (e: any) {
      // 列可能已存在，忽略
    }

    // 迁移：为 usdt_orders 表添加 uqpay_order_id 列
    try {
      database.run(`ALTER TABLE usdt_orders ADD COLUMN uqpay_order_id VARCHAR(100)`);
    } catch (e: any) {
      // 列可能已存在，忽略
    }

    console.log('[Wallet] Migrations applied');
  } catch (e) {
    console.error('[Wallet] initWalletTables error:', e);
  }
};

// ── 渠道 SDK 工厂 ──────────────────────────────────────────────────────────

async function getWalletChannelSDK() {
  // UQPay 渠道
  const uqpayChannel = db.prepare(
    "SELECT * FROM card_channels WHERE channel_code = 'UQPAY' AND status = 1"
  ).get() as any;

  if (uqpayChannel) {
    let config: Record<string, any> = {};
    try {
      config = JSON.parse(uqpayChannel.config_json || '{}');
    } catch (_) {}

    const { UqPaySDK } = await import('../channels/uqpay');
    const sdk = new UqPaySDK({
      clientId: config.clientId || uqpayChannel.api_key || '',
      apiKey: config.apiSecret || uqpayChannel.api_secret || '',
      baseUrl: uqpayChannel.api_base_url || undefined,
    });

    if (config.depositAddresses) {
      (sdk as any)._platformDepositAddresses = config.depositAddresses;
    }

    return { type: 'uqpay' as const, sdk, channel: uqpayChannel };
  }

  // DogPay 渠道
  const dogpayChannel = db.prepare(
    "SELECT * FROM card_channels WHERE channel_code = 'dogpay' AND status = 1"
  ).get() as any;

  if (dogpayChannel) {
    try {
      const { DogPaySDK } = await import('../channels/dogpay');
      const sdk = new DogPaySDK({
        appId: dogpayChannel.api_key,
        appSecret: dogpayChannel.api_secret,
        apiBaseUrl: dogpayChannel.api_base_url,
      });
      return { type: 'dogpay' as const, sdk, channel: dogpayChannel };
    } catch (err: any) {
      console.error('[Wallet] DogPay SDK 加载失败:', err.message);
    }
  }

  return { type: 'none' as const };
}

// ── 辅助函数 ────────────────────────────────────────────────────────────────

const getUserId = (req: any) => req.user?.userId;

const chainMap: Record<string, string> = {
  TRC20: 'trx',
  ERC20: 'eth',
  BEP20: 'bnb',
};

const chainNameMap: Record<string, string> = {
  trx: 'TRC20',
  eth: 'ERC20',
  bnb: 'BEP20',
};

// ── 钱包信息 ────────────────────────────────────────────────────────────────

router.get('/info', (req, res) => {
  const userId = getUserId(req);

  let wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;

  if (!wallet) {
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
      currency: 'USD',
    };
  }

  res.json({
    code: 0,
    data: {
      ...wallet,
      defaultAddress: null,
      warning: '请通过「充值地址」接口获取真实充值地址'
    },
    timestamp: Date.now()
  });
});

// ── 获取充值地址 ────────────────────────────────────────────────────────────

router.get('/address', async (req, res) => {
  const userId = getUserId(req);
  const { network = 'TRC20' } = req.query;

  try {
    const channel = await getWalletChannelSDK();

    if (channel.type === 'uqpay' && channel.sdk) {
      const sdk = channel.sdk;
      const chain = chainMap[network as string] || 'trx';

      try {
        const addr = await sdk.getDepositAddress(chain);
        return res.json({
          code: 0,
          data: {
            address: addr.address,
            network: chainNameMap[chain] || network,
            qrCode: addr.qrCode || '',
            channel: 'UQPAY',
          },
          timestamp: Date.now(),
        });
      } catch (err: any) {
        console.error('[Wallet/UQPay] getDepositAddress error:', err.message);
        return res.json({
          code: 503,
          message: err.message.includes('config_json')
            ? '管理员尚未配置充值地址，请联系平台'
            : '充值服务暂不可用，请稍后重试',
          timestamp: Date.now(),
        });
      }
    }

    if (channel.type === 'dogpay' && channel.sdk) {
      const result = await channel.sdk.getDepositAddress({ chain: chainMap[network as string] || 'trx' });
      if (result?.data?.address) {
        return res.json({
          code: 0,
          data: {
            address: result.data.address,
            network: network,
            qrCode: result.data.qrCode || '',
            channel: 'DOGPAY',
          },
          timestamp: Date.now(),
        });
      }
    }

  } catch (err: any) {
    console.error('[Wallet] getDepositAddress error:', err.message);
  }

  return res.json({
    code: 503,
    message: '充值服务暂不可用，请稍后重试或联系客服',
    timestamp: Date.now(),
  });
});

// ── 充值订单列表 ────────────────────────────────────────────────────────────

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

  const total = (db.prepare(
    'SELECT COUNT(*) as c FROM usdt_orders WHERE user_id = ?'
  ).get(userId) as any).c;

  res.json({
    code: 0,
    data: { list, total, page: Number(page), pageSize: Number(pageSize) },
    timestamp: Date.now(),
  });
});

// ── 创建充值订单（C2C买币）───────────────────────────────────────────────────

router.post('/deposit/c2c', async (req, res) => {
  const userId = getUserId(req);

  if (!userId) {
    return res.json({ code: 401, message: '用户未登录' });
  }

  const { amountUsdt, network = 'TRC20' } = req.body;

  if (!amountUsdt || amountUsdt <= 0) {
    return res.json({ code: 400, message: '请输入有效的充值金额' });
  }

  const orderNo = `DP${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const chain = chainMap[network as string] || 'trx';

  let payAddress = '';
  let dogpayOrderId = '';
  let uqpayOrderId = '';
  let channelCode = 'NONE';

  try {
    const channel = await getWalletChannelSDK();

    if (channel.type === 'uqpay' && channel.sdk) {
      const sdk = channel.sdk;
      channelCode = 'UQPAY';

      try {
        const orderResult = await sdk.createC2COrder({
          amount: Number(amountUsdt),
          token: 'USDT',
          network: chain,
          userId: String(userId),
        });

        payAddress = orderResult.payAddress;
        uqpayOrderId = orderResult.orderId;
        const expireAt = orderResult.expireAt;

        const result = db.prepare(`
          INSERT INTO usdt_orders (order_no, user_id, amount_usdt, amount_usd, exchange_rate,
            network, pay_address, status, uqpay_order_id, expire_at)
          VALUES (?, ?, ?, ?, 1.0, ?, ?, 0, ?, ?)
        `).run(orderNo, userId, amountUsdt, amountUsdt, network, payAddress, uqpayOrderId, expireAt);

        return res.json({
          code: 0,
          data: {
            orderId: result.lastInsertRowid,
            orderNo,
            amountUsdt,
            amountUsd: amountUsdt,
            exchangeRate: 1.0,
            network,
            payAddress,
            expireAt,
            channel: 'UQPAY',
          },
          timestamp: Date.now(),
        });

      } catch (err: any) {
        console.error('[Wallet/UQPay] createC2COrder error:', err.message);
        return res.json({
          code: 503,
          message: err.message.includes('config_json') || err.message.includes('配置')
            ? '平台充值地址未配置，请联系管理员'
            : '充值通道暂不可用，请稍后重试',
          timestamp: Date.now(),
        });
      }
    }

    if (channel.type === 'dogpay' && channel.sdk) {
      const result = await channel.sdk.createC2COrder({
        amount: Number(amountUsdt),
        token: 'USDT',
        network: chain,
      });

      if (result?.data) {
        payAddress = result.data.payAddress || '';
        dogpayOrderId = result.data.orderId || '';
        channelCode = 'DOGPAY';
      }
    }

  } catch (err: any) {
    console.error('[Wallet] createC2COrder error:', err.message);
  }

  // 无可用渠道时拒绝创建
  if (!payAddress) {
    return res.json({
      code: 503,
      message: '充值通道暂不可用，请稍后重试',
      timestamp: Date.now(),
    });
  }

  const expireAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const result = db.prepare(`
    INSERT INTO usdt_orders (order_no, user_id, amount_usdt, amount_usd, exchange_rate,
      network, pay_address, status, dogpay_order_id, expire_at)
    VALUES (?, ?, ?, ?, 1.0, ?, ?, 0, ?, ?)
  `).run(orderNo, userId, amountUsdt, amountUsdt, network, payAddress, dogpayOrderId || null, expireAt);

  res.json({
    code: 0,
    data: {
      orderId: result.lastInsertRowid,
      orderNo,
      amountUsdt,
      amountUsd: amountUsdt,
      exchangeRate: 1.0,
      network,
      payAddress,
      expireAt,
      channel: channelCode,
    },
    timestamp: Date.now(),
  });
});

// ── 充值订单详情 ────────────────────────────────────────────────────────────

router.get('/deposits/:id', (req, res) => {
  const userId = getUserId(req);
  const order = db.prepare(
    'SELECT * FROM usdt_orders WHERE id = ? AND user_id = ?'
  ).get(req.params.id, userId);

  if (!order) {
    return res.json({ code: 404, message: '订单不存在' });
  }

  res.json({ code: 0, data: order, timestamp: Date.now() });
});

// ── 钱包流水记录 ────────────────────────────────────────────────────────────

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

  const total = (db.prepare(
    `SELECT COUNT(*) as c FROM wallet_records ${whereClause}`
  ).get(...params) as any).c;

  res.json({
    code: 0,
    data: { list, total, page: Number(page), pageSize: Number(pageSize) },
    timestamp: Date.now(),
  });
});

// ── 钱包统计 ────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  const userId = getUserId(req);

  let wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as any;
  if (!wallet) {
    db.prepare(
      'INSERT INTO wallets (user_id, balance_usd, balance_usdt, locked_usd, currency) VALUES (?, 0, 0, 0, ?)'
    ).run(userId, 'USD');
    wallet = { balance_usd: 0, balance_usdt: 0, locked_usd: 0 };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayDeposit = db.prepare(`
    SELECT COALESCE(SUM(amount_usd), 0) as total
    FROM usdt_orders
    WHERE user_id = ? AND status >= 1 AND created_at >= ?
  `).get(userId, todayStart.toISOString()) as any;

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
      monthDeposit: monthDeposit?.total || 0,
    },
    timestamp: Date.now(),
  });
});

export default router;
