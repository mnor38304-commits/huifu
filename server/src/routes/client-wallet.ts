import { Router } from 'express';
import db, { getDb, saveDatabase } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { CoinPalSDK } from '../channels/coinpal';

const router = Router();

// ── 迁移函数 ────────────────────────────────────────────────────────────────
export const initWalletTables = () => {
  try {
    const database = getDb();
    // 迁移：usdt_orders 表新增列（幂等运行）
    const migrations = [
      `ALTER TABLE usdt_orders ADD COLUMN dogpay_order_id VARCHAR(100)`,
      `ALTER TABLE usdt_orders ADD COLUMN uqpay_order_id VARCHAR(100)`,
      `ALTER TABLE usdt_orders ADD COLUMN coinpal_order_no VARCHAR(100)`,
      `ALTER TABLE usdt_orders ADD COLUMN coinpal_reference VARCHAR(100)`,
      `ALTER TABLE usdt_orders ADD COLUMN paid_address VARCHAR(500)`,
      `ALTER TABLE usdt_orders ADD COLUMN paid_amount DECIMAL(20,8) DEFAULT 0`,
      `ALTER TABLE usdt_orders ADD COLUMN channel_order_no VARCHAR(200)`,
      `ALTER TABLE usdt_orders ADD COLUMN confirmed_at DATETIME`,
    ];
    for (const sql of migrations) {
      try { database.run(sql); } catch (_) { /* 列可能已存在 */ }
    }
    console.log('[Wallet] Migrations applied');
  } catch (e) {
    console.error('[Wallet] initWalletTables error:', e);
  }
};

// ── 渠道 SDK 工厂 ──────────────────────────────────────────────────────────
async function getWalletChannelSDK() {
  // 1. UQPay 渠道（优先级最高）
  const uqpayChannel = db.prepare(
    "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'UQPAY' AND status = 1"
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

  // 2. CoinPal 渠道（收银台模式）
  const coinpalChannel = db.prepare(
    "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'COINPAL' AND status = 1"
  ).get() as any;
  if (coinpalChannel) {
    try {
      let config: Record<string, any> = {};
      try {
        config = JSON.parse(coinpalChannel.config_json || '{}');
      } catch (_) {}

      const sdk = new CoinPalSDK({
        merchantNo: config.merchantNo || coinpalChannel.api_key || '',
        secretKey: config.secretKey || coinpalChannel.api_secret || '',
        apiBaseUrl: coinpalChannel.api_base_url || undefined,
      });
      return { type: 'coinpal' as const, sdk, channel: coinpalChannel };
    } catch (err: any) {
      console.error('[Wallet] CoinPal SDK 加载失败:', err.message);
    }
  }

  // 3. DogPay 渠道（最后兜底）
  const dogpayChannel = db.prepare(
    "SELECT * FROM card_channels WHERE LOWER(channel_code) = 'dogpay' AND status = 1"
  ).get() as any;
  if (dogpayChannel) {
    try {
      const { DogPaySDK } = await import('../channels/dogpay');
      let config: Record<string, any> = {};
      try {
        config = JSON.parse(dogpayChannel.config_json || '{}');
      } catch (_) {}
      const sdk = new DogPaySDK({
        appId: config.appId || dogpayChannel.api_key || '',
        appSecret: config.appSecret || dogpayChannel.api_secret || '',
        apiBaseUrl: dogpayChannel.api_base_url || undefined,
      });
      return { type: 'dogpay' as const, sdk, channel: dogpayChannel };
    } catch (err: any) {
      console.error('[Wallet] DogPay SDK 加载失败:', err.message);
    }
  }

  return null;
}

// ── 钱包信息 ────────────────────────────────────────────────────────────────
router.get('/info', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  let wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as { total: number };
  if (!wallet) {
    const result = db.prepare(`
      INSERT INTO wallets (user_id, balance_usd, balance_usdt, locked_usd, currency)
      VALUES (?, 0, 0, 0, 'USD')
    `).run(userId);
    const wallet: any = {
      id: result.lastInsertRowid,
      user_id: userId,
      balance_usd: 0,
      balance_usdt: 0,
      locked_usd: 0,
      currency: 'USD',
    };
  }
  res.json({ code: 0, data: wallet, timestamp: Date.now() });
});

// ── 钱包统计数据 ──────────────────────────────────────────────────────────
router.get('/stats', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const rows = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 1 THEN amount_usdt ELSE 0 END) as total_deposited,
      SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as deposit_count
    FROM usdt_orders WHERE user_id = ?
  `).get(userId) as { total_deposited: number; deposit_count: number };
  res.json({
    code: 0,
    data: {
      totalDeposited: rows.total_deposited || 0,
      depositCount: rows.deposit_count || 0,
    },
    timestamp: Date.now(),
  });
});

// ── USDT→USD 钱包兑换（默认关闭，仅灰度测试）─────────────────────
router.post('/convert/usdt-to-usd', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  if (!userId) {
    return res.json({ code: 401, message: '用户未登录' });
  }

  // 1. 功能开关检查
  const enabled = process.env.ENABLE_WALLET_CONVERT === 'true';
  if (!enabled) {
    return res.json({ code: 403, message: '钱包兑换功能暂未开放' });
  }

  // 2. 灰度白名单检查
  const testUserIds = (process.env.WALLET_CONVERT_TEST_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (testUserIds.length > 0 && !testUserIds.includes(String(userId))) {
    return res.json({ code: 403, message: '您暂时无法使用兑换功能' });
  }

  // 3. 参数校验
  const { amount_usdt } = req.body;
  const numAmount = Number(amount_usdt);
  if (!amount_usdt || isNaN(numAmount) || numAmount <= 0) {
    return res.json({ code: 400, message: '请输入有效的 USDT 兑换数量' });
  }

  // 4. 幂等键
  const idempotencyKey = (req.headers['idempotency-key'] as string)
    || `convert-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  if (idempotencyKey.length > 64) {
    return res.json({ code: 400, message: 'Idempotency-Key 长度不能超过 64 字符' });
  }

  // 5. 汇率
  const rate = parseFloat(process.env.USDT_TO_USD_RATE || '1.0');
  if (isNaN(rate) || rate <= 0) {
    return res.json({ code: 500, message: '系统汇率配置异常' });
  }
  const amountUsd = parseFloat((numAmount * rate).toFixed(2));

  try {
    // 6. 幂等检查
    const existing = db.prepare('SELECT * FROM wallet_conversions WHERE idempotency_key = ?').get(idempotencyKey) as any;
    if (existing) {
      return res.json({
        code: 0,
        message: '该订单已处理',
        data: {
          id: existing.id,
          amount_usdt: existing.amount_usdt,
          amount_usd: existing.amount_usd,
          rate: existing.rate,
          balance_usdt_before: existing.balance_usdt_before,
          balance_usdt_after: existing.balance_usdt_after,
          balance_usd_before: existing.balance_usd_before,
          balance_usd_after: existing.balance_usd_after,
          created_at: existing.created_at,
        },
        timestamp: Date.now(),
      });
    }

    // 7. 原子兑换（使用底层 API 保证事务原子性）
    const database = getDb();
    database.run('BEGIN TRANSACTION');

    try {
      // 7a. 读取钱包
      const walletRow = database.exec(
        'SELECT id, balance_usd, balance_usdt FROM wallets WHERE user_id = ?',
        [userId]
      );
      let wallet: any;
      if (walletRow.length > 0 && walletRow[0].values.length > 0) {
        const cols = walletRow[0].columns;
        const vals = walletRow[0].values[0];
        wallet = {};
        cols.forEach((c: string, i: number) => { wallet[c] = vals[i]; });
      }

      if (!wallet) {
        database.run('ROLLBACK');
        saveDatabase();
        return res.json({ code: 400, message: '钱包不存在，请先充值' });
      }

      const balanceUsdtBefore = Number(wallet.balance_usdt) || 0;
      const balanceUsdBefore = Number(wallet.balance_usd) || 0;

      if (balanceUsdtBefore < numAmount) {
        database.run('ROLLBACK');
        saveDatabase();
        return res.json({ code: 400, message: `USDT 余额不足，当前余额 ${balanceUsdtBefore} USDT` });
      }

      const balanceUsdtAfter = parseFloat((balanceUsdtBefore - numAmount).toFixed(8));
      const balanceUsdAfter = parseFloat((balanceUsdBefore + amountUsd).toFixed(2));

      // 7b. 更新钱包余额
      database.run(
        'UPDATE wallets SET balance_usdt = ?, balance_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
        [balanceUsdtAfter, balanceUsdAfter, userId]
      );

      // 7c. 插入兑换记录
      database.run(
        `INSERT INTO wallet_conversions (user_id, amount_usdt, amount_usd, rate,
          balance_usdt_before, balance_usdt_after,
          balance_usd_before, balance_usd_after,
          idempotency_key, remark, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED')`,
        [userId, numAmount, amountUsd, rate,
          balanceUsdtBefore, balanceUsdtAfter,
          balanceUsdBefore, balanceUsdAfter,
          idempotencyKey, `USDT→USD 兑换 r=1:${rate}`]
      );

      // 获取 conversion id
      const convIdRows = database.exec('SELECT last_insert_rowid() as id');
      let conversionId = 0;
      if (convIdRows.length > 0 && convIdRows[0].values.length > 0) {
        conversionId = Number(convIdRows[0].values[0][0]);
      }

      // 7d. 钱包流水：USDT 扣减
      database.run(
        `INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type, reference_id)
        VALUES (?, 'CONVERT_OUT', ?, ?, ?, 'USDT', ?, 'wallet_conversion', ?)`,
        [userId, -numAmount, balanceUsdtBefore, balanceUsdtAfter,
         `USDT→USD 兑换：扣除 ${numAmount} USDT`, conversionId]
      );

      // 7e. 钱包流水：USD 增加
      database.run(
        `INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type, reference_id)
        VALUES (?, 'CONVERT_IN', ?, ?, ?, 'USD', ?, 'wallet_conversion', ?)`,
        [userId, amountUsd, balanceUsdBefore, balanceUsdAfter,
         `USDT→USD 兑换：增加 ${amountUsd} USD`, conversionId]
      );

      database.run('COMMIT');
      saveDatabase();

      return res.json({
        code: 0,
        message: '兑换成功',
        data: {
          id: conversionId,
          amount_usdt: numAmount,
          amount_usd: amountUsd,
          rate,
          balance_usdt_before: balanceUsdtBefore,
          balance_usdt_after: balanceUsdtAfter,
          balance_usd_before: balanceUsdBefore,
          balance_usd_after: balanceUsdAfter,
          created_at: new Date().toISOString(),
        },
        timestamp: Date.now(),
      });
    } catch (txErr: any) {
      database.run('ROLLBACK');
      saveDatabase();
      throw txErr;
    }
  } catch (err: any) {
    console.error('[Wallet/Convert] USDT→USD 兑换失败:', err.message);
    return res.json({
      code: 500,
      message: '兑换处理失败，请稍后重试',
      timestamp: Date.now(),
    });
  }
});

// ── 充值地址 / 收银台入口（支持所有渠道）───────────────────────────────
router.post('/deposit/c2c', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  if (!userId) {
    return res.json({ code: 401, message: '用户未登录' });
  }

  const { amountUsdt, network = 'TRC20' } = req.body;
  if (!amountUsdt || Number(amountUsdt) <= 0) {
    return res.json({ code: 400, message: '请输入有效的充值金额' });
  }

  // 商户内部订单号（幂等）
  const orderNo = `DP${Date.now()}${Math.floor(Math.random() * 1000)}`;

  // 网络映射
  const chainMap: Record<string, string> = {
    trc20: 'trx', eth: 'eth', bep20: 'bnb',
    TRC20: 'trx', ERC20: 'eth', BEP20: 'bnb',
  };
  const chain = chainMap[network] || 'trx';

  try {
    const channel = await getWalletChannelSDK();

    // ══════════════════════════════════════════════════════════
    // 方式一：CoinPal 收银台模式
    // 用户在 CoinPal 收银台扫码/复制地址充值，链上确认后 IPN 回调通知
    // ══════════════════════════════════════════════════════════
    if (channel?.type === 'coinpal' && channel.sdk) {
      const sdk = channel.sdk as CoinPalSDK;
      const API_BASE = process.env.API_BASE_URL || 'https://cardgolink.com';
      const CLIENT_BASE = process.env.CLIENT_BASE_URL || 'https://cardgolink.com';

      try {
        const result = await sdk.createOrder({
          amount: Number(amountUsdt),
          userId: String(userId),
          orderNo,
          notifyUrl: `${API_BASE}/api/v1/webhook/coinpal/notify`,
          redirectUrl: `${CLIENT_BASE}/wallet?status=success&order=${orderNo}`,
          payerIp: req.ip || '127.0.0.1',
          orderDescription: `CardGoLink USDT Deposit #${orderNo}`,
        });

        // 保存订单到数据库
        const coinpalRef = result.reference || '';  // CoinPal 平台订单号 (CWSxxx)
        const dbResult = db.prepare(`
          INSERT INTO usdt_orders (
            order_no, user_id, amount_usdt, amount_usd, exchange_rate,
            network, pay_address, status, coinpal_order_no, coinpal_reference,
            expire_at
          ) VALUES (?, ?, ?, ?, 1.0, ?, ?, 0, ?, ?, datetime('now', '+2 hours'))
        `).run(
          orderNo,
          userId,
          amountUsdt,
          amountUsdt,
          network,
          result.paymentUrl, // CoinPal 用 paymentUrl 作为 pay_address（展示给用户跳转）
          orderNo,           // coinpal_order_no: 我们系统的商户订单号 (DPxxx)
          coinpalRef,        // coinpal_reference: CoinPal 平台订单号 (CWSxxx)，用于 queryOrder gcid
        );

        // 安全日志：记录关键字段，不输出密钥，paymentUrl 截断
        const paymentUrlPreview = result.paymentUrl ? result.paymentUrl.substring(0, 60) + '...' : 'N/A';
        const notifyDomain = new URL(API_BASE).hostname;
        console.log(`[Wallet/CoinPal] 订单创建成功: orderNo=${orderNo}, coinpalRef=${coinpalRef || 'EMPTY'}, notifyDomain=${notifyDomain}, paymentUrl=${paymentUrlPreview}`);
        if (!coinpalRef) {
          console.warn(`[Wallet/CoinPal] ⚠️ CoinPal 返回 reference 为空，主动查询将无法使用 gcid`);
        }

        return res.json({
          code: 0,
          data: {
            orderId: dbResult.lastInsertRowid,
            orderNo,
            amountUsdt,
            amountUsd: amountUsdt,
            exchangeRate: 1.0,
            network,
            // 收银台跳转链接
            paymentUrl: result.paymentUrl,
            // 平台订单号（用于查询）
            coinpalReference: result.reference,
            channel: 'COINPAL',
            // 前端直接跳转至此 URL 完成充值
            cashierUrl: result.paymentUrl,
          },
          timestamp: Date.now(),
        });
      } catch (err: any) {
        console.error('[Wallet/CoinPal] createOrder error:', err.message);
        return res.json({
          code: 503,
          message: '充值通道暂不可用，请稍后重试',
          timestamp: Date.now(),
        });
      }
    }

    // ══════════════════════════════════════════════════════════
    // 方式二：UQPay 直接地址模式
    // ══════════════════════════════════════════════════════════
    if (channel?.type === 'uqpay' && channel.sdk) {
      try {
        const sdk = channel.sdk;
        const orderResult: any = await sdk.createC2COrder({
          amount: Number(amountUsdt),
          token: 'USDT',
          network: chain,
          userId: String(userId),
        });
        const payAddress = orderResult.payAddress;
        const uqpayOrderId = orderResult.orderId;
        const expireAt = orderResult.expireAt;

        const dbResult = db.prepare(`
          INSERT INTO usdt_orders (
            order_no, user_id, amount_usdt, amount_usd, exchange_rate,
            network, pay_address, status, uqpay_order_id, expire_at
          ) VALUES (?, ?, ?, ?, 1.0, ?, ?, 0, ?, ?)
        `).run(orderNo, userId, amountUsdt, amountUsdt, network, payAddress, uqpayOrderId, expireAt);

        return res.json({
          code: 0,
          data: {
            orderId: dbResult.lastInsertRowid,
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

    // ══════════════════════════════════════════════════════════
    // 方式三：DogPay 地址模式（兜底）
    // ══════════════════════════════════════════════════════════
    if (channel?.type === 'dogpay' && channel.sdk) {
      try {
        const result = await channel.sdk.createC2COrder({
          amount: Number(amountUsdt),
          token: 'USDT',
          network: chain,
        });
        if (result?.data) {
          const payAddress = result.data.payAddress || '';
          const dogpayOrderId = result.data.orderId || '';
          const dbResult = db.prepare(`
            INSERT INTO usdt_orders (
              order_no, user_id, amount_usdt, amount_usd, exchange_rate,
              network, pay_address, status, dogpay_order_id, expire_at
            ) VALUES (?, ?, ?, ?, 1.0, ?, ?, 0, ?, datetime('now', '+30 minutes'))
          `).run(orderNo, userId, amountUsdt, amountUsdt, network, payAddress, dogpayOrderId);

          return res.json({
            code: 0,
            data: {
              orderId: dbResult.lastInsertRowid,
              orderNo,
              amountUsdt,
              amountUsd: amountUsdt,
              exchangeRate: 1.0,
              network,
              payAddress,
              channel: 'DOGPAY',
            },
            timestamp: Date.now(),
          });
        }
      } catch (err: any) {
        console.error('[Wallet/DogPay] createC2COrder error:', err.message);
      }
    }

    // 无可用渠道
    return res.json({
      code: 503,
      message: '充值通道暂不可用，请稍后重试',
      timestamp: Date.now(),
    });
  } catch (err: any) {
    console.error('[Wallet] createC2COrder error:', err.message);
    return res.json({
      code: 500,
      message: '服务器错误，请稍后重试',
      timestamp: Date.now(),
    });
  }
});

// ── 充值记录列表 ──────────────────────────────────────────────────────────
router.get('/deposits', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  const list: any[] = db.prepare(`
    SELECT id, order_no, amount_usdt, amount_usd, network, pay_address,
           status, created_at, expire_at, coinpal_order_no, coinpal_reference,
           paid_address, paid_amount, channel_order_no, confirmed_at
    FROM usdt_orders
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset);

  const { total } = db.prepare(
    'SELECT COUNT(*) as total FROM usdt_orders WHERE user_id = ?'
  ).get(userId) as { total: number };

  res.json({ code: 0, data: { list, total, page, pageSize }, timestamp: Date.now() });
});

// ── 查询充值订单状态（主动查询 CoinPal）─────────────────────────────
router.get('/deposit/:orderNo/status', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { orderNo } = req.params;

  const order = db.prepare('SELECT * FROM usdt_orders WHERE order_no = ? AND user_id = ?')
    .get(orderNo, userId) as any;
  if (!order) {
    return res.json({ code: 404, message: '订单不存在' });
  }

  // 如果是 CoinPal 订单且未完成，主动查询 CoinPal
  if (order.coinpal_reference && order.status === 0) {
    try {
      const channel = db.prepare(
        "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'COINPAL' AND status = 1"
      ).get() as any;
      if (channel) {
        let config: Record<string, any> = {};
        try { config = JSON.parse(channel.config_json || '{}'); } catch (_) {}
        const sdk = new CoinPalSDK({
          merchantNo: config.merchantNo || channel.api_key || '',
          secretKey: config.secretKey || channel.api_secret || '',
          apiBaseUrl: channel.api_base_url || undefined,
        });
        const gcid = order.coinpal_reference;
        console.log(`[Wallet] CoinPal 主动查询: orderNo=${orderNo}, gcid=${gcid}`);
        const cpResult = await sdk.queryOrder(gcid);
        console.log(`[Wallet] CoinPal 主动查询结果: orderNo=${orderNo}, status=${cpResult.status}, paidAmount=${cpResult.paidAmount || 'N/A'}`);

        // 同步到数据库：仅 status=0 时原子更新，防止重复入账
        if (cpResult.status === 'paid') {
          // 用底层 database 执行原子更新并检测 affected rows
          const database = getDb();
          database.run(
            `UPDATE usdt_orders SET status=1, paid_address=?, paid_amount=?,
            confirmed_at=COALESCE(confirmed_at, datetime('now')),
            updated_at=datetime('now')
            WHERE order_no=? AND status=0`,
            [cpResult.paidAddress || '', cpResult.paidAmount || order.amount_usdt, orderNo]
          );
          const didUpdate = database.getRowsModified() > 0;
          saveDatabase();

          // 只有确实从 0→1 才给钱包加款
          if (didUpdate) {
            const creditAmount = parseFloat(cpResult.paidAmount || order.amount_usdt);
            if (creditAmount > 0 && Number.isFinite(creditAmount)) {
              const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as { total: number } as any;
              const balanceBefore = wallet ? wallet.balance_usdt : 0;
              if (wallet) {
                db.prepare('UPDATE wallets SET balance_usdt = balance_usdt + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
                  .run(creditAmount, userId);
              } else {
                db.prepare('INSERT INTO wallets (user_id, balance_usdt, balance_usd) VALUES (?, ?, 0)')
                  .run(userId, creditAmount);
              }
              const balanceAfter = (wallet ? wallet.balance_usdt : 0) + creditAmount;

              // 写入钱包流水
              db.prepare(`
                INSERT INTO wallet_records (user_id, type, amount, balance_before, balance_after, currency, remark, reference_type)
                VALUES (?, 'TOPUP', ?, ?, ?, 'USDT', ?, 'usdt_order')
              `).run(userId, creditAmount, balanceBefore, balanceAfter, `CoinPal 主动查询到账 订单${orderNo}`);

              console.log(`[Wallet] CoinPal 主动查询到账: orderNo=${orderNo}, amount=${creditAmount} (${balanceBefore} → ${balanceAfter})`);
            }
          } else {
            console.log(`[Wallet] CoinPal 主动查询: 订单${orderNo} 已是终态，跳过加款`);
          }
        } else if (cpResult.status === 'failed') {
          // 标记失败
          const database = getDb();
          database.run(
            `UPDATE usdt_orders SET status=2, updated_at=datetime('now')
            WHERE order_no=? AND status=0`,
            [orderNo]
          );
          database.getRowsModified();
          saveDatabase();
          console.log(`[Wallet] CoinPal 主动查询: 订单${orderNo} 已标记失败`);
        } else if (cpResult.status === 'paid_confirming') {
          // 待公链确认：更新订单信息但不入账
          const database = getDb();
          database.run(
            `UPDATE usdt_orders SET
              paid_address = COALESCE(?, paid_address),
              paid_amount = COALESCE(?, paid_amount),
              updated_at = datetime('now')
            WHERE order_no=? AND status=0`,
            [cpResult.paidAddress || null, cpResult.paidAmount || null, orderNo]
          );
          database.getRowsModified();
          saveDatabase();
          console.log(`[Wallet] CoinPal 主动查询: 订单${orderNo} paid_confirming，更新信息但不入账`);
        }
        // paid_confirming / pending / unpaid / partial_paid_confirming 不处理
      }
    } catch (err: any) {
      console.warn('[Wallet] CoinPal 主动查询失败:', err.message);
    }
  }

  // 返回最新状态
  const updatedOrder = db.prepare('SELECT * FROM usdt_orders WHERE order_no = ?').get(orderNo);
  res.json({ code: 0, data: updatedOrder, timestamp: Date.now() });
});

// ── 兑换记录列表 ──────────────────────────────────────────────────
router.get('/convert/records', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  const list: any[] = db.prepare(`
    SELECT id, amount_usdt, amount_usd, rate,
           balance_usdt_before, balance_usdt_after,
           balance_usd_before, balance_usd_after,
           status, remark, created_at
    FROM wallet_conversions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset);

  const { total } = db.prepare(
    'SELECT COUNT(*) as total FROM wallet_conversions WHERE user_id = ?'
  ).get(userId) as { total: number };

  res.json({ code: 0, data: { list, total, page, pageSize }, timestamp: Date.now() });
});

export default router;