import { Router } from 'express';
import db from '../db';
import { adminAuth } from './admin-auth';
import { DogPaySDK } from '../channels/dogpay';

// 获取DogPay SDK实例
async function getDogPaySDK() {
  const channel = db.prepare("SELECT * FROM card_channels WHERE channel_code = 'dogpay' AND status = 1").get() as any;
  if (!channel) return null;
  return new DogPaySDK({
    appId: channel.api_key,
    appSecret: channel.api_secret,
    apiBaseUrl: channel.api_base_url
  });
}

const router = Router();

// ── USDT 充值订单列表 ─────────────────────────────────────────
router.get('/orders', adminAuth, (req, res) => {
  const { page=1, pageSize=20, status, keyword } = req.query;
  let sql = `SELECT o.*, u.phone, u.email, u.user_no FROM usdt_orders o
    LEFT JOIN users u ON o.user_id=u.id WHERE 1=1`;
  const params: any[] = [];
  if (status !== undefined && status !== '') { sql += ' AND o.status=?'; params.push(Number(status)); }
  if (keyword) { sql += ' AND (u.phone LIKE ? OR u.user_no LIKE ? OR o.tx_hash LIKE ?)'; params.push(`%${keyword}%`,`%${keyword}%`,`%${keyword}%`); }

  const countSql = sql.replace('SELECT o.*, u.phone, u.email, u.user_no FROM usdt_orders o', 'SELECT COUNT(*) as c FROM usdt_orders o');
  const total = (db.prepare(countSql).get(...params) as any).c;
  sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), (Number(page)-1)*Number(pageSize));
  const list = db.prepare(sql).all(...params);
  res.json({ code: 0, data: { list, total }, timestamp: Date.now() });
});

// ── 手动确认 USDT 到账 ────────────────────────────────────────
router.post('/orders/:id/confirm', adminAuth, (req: any, res) => {
  const { txHash } = req.body;
  const order = db.prepare('SELECT * FROM usdt_orders WHERE id=?').get(req.params.id) as any;
  if (!order) return res.json({ code: 404, message: '订单不存在' });
  if (order.status === 2) return res.json({ code: 400, message: '订单已确认' });

  // 更新订单状态
  db.prepare('UPDATE usdt_orders SET status=2,tx_hash=?,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(txHash||order.tx_hash, req.params.id);

  // 给用户账户充值（这里简化为给第一张正常卡充值，实际应有账户余额概念）
  const txnNo = `USDT${Date.now()}${Math.floor(Math.random()*1000)}`;
  db.prepare(`INSERT INTO transactions (txn_no,card_id,user_id,txn_type,amount,fee,currency,status,merchant_name,txn_time)
    SELECT ?,id,user_id,'TOPUP',?,0,'USD',1,'USDT充值',CURRENT_TIMESTAMP FROM cards WHERE user_id=? AND status=1 LIMIT 1
  `).run(txnNo, order.amount_usd, order.user_id);

  db.prepare(`INSERT INTO admin_logs (admin_id,admin_name,action,target_type,target_id,detail) VALUES (?,?,?,?,?,?)`).run(
    req.admin.id, req.admin.username, '确认USDT到账', 'usdt_order', req.params.id, `金额:${order.amount_usdt} USDT`
  );
  res.json({ code: 0, message: '已确认到账', timestamp: Date.now() });
});

// ── 创建 USDT 充值地址（商户端调用）────────────────────────────
router.post('/create', async (req, res) => {
  const { userId, amountUsdt, network } = req.body;
  if (!userId || !amountUsdt) return res.json({ code: 400, message: '参数缺失' });

  const exchangeRate = 1.0;  // 1 USDT = 1 USD
  const amountUsd = amountUsdt * exchangeRate;
  const net = (network || 'TRC20') as string;
  const orderNo = `USDT${Date.now()}${Math.floor(Math.random()*1000)}`;
  const expireAt = new Date(Date.now() + 30*60*1000).toISOString();

  let payAddress = '';

  // 尝试获取DogPay充值地址
  const sdk = await getDogPaySDK();
  if (sdk) {
    try {
      const addrResult = await sdk.getDepositAddress({ chain: net === 'TRC20' ? 'trx' : net === 'ERC20' ? 'eth' : 'bnb' });
      // 优先使用API返回的地址，否则使用本地缓存地址
      if (addrResult?.data?.address) {
        payAddress = addrResult.data.address;
      }
    } catch (err: any) {
      console.error('[DogPay] getDepositAddress error:', err.message);
    }
  }

  // 如果没有获取到地址，使用备用地址
  if (!payAddress) {
    const addresses: Record<string, string> = {
      TRC20: 'TRx7NqmJHkFxyz1234567890abcdefghij',
      ERC20: '0xAbCdEf1234567890abcdef1234567890AbCdEf12',
      BEP20: '0xBnBAddr1234567890abcdef1234567890BnBAddr'
    };
    payAddress = addresses[net] || addresses['TRC20'];
  }

  const result = db.prepare(`
    INSERT INTO usdt_orders (order_no,user_id,amount_usdt,amount_usd,exchange_rate,network,pay_address,status,expire_at)
    VALUES (?,?,?,?,?,?,?,0,?)
  `).run(orderNo, userId, amountUsdt, amountUsd, exchangeRate, net, payAddress, expireAt);

  res.json({ code: 0, data: {
    orderId: result.lastInsertRowid, orderNo, amountUsdt, amountUsd,
    exchangeRate, network: net, payAddress, expireAt
  }, timestamp: Date.now() });
});

// ── 获取充值地址（对接DogPay）────────────────────────────
router.get('/address', async (req, res) => {
  const { network = 'TRC20' } = req.query;

  const sdk = await getDogPaySDK();
  if (!sdk) {
    return res.json({ code: 400, message: 'DogPay渠道未配置或未启用', timestamp: Date.now() });
  }

  try {
    const chainMap: Record<string, string> = {
      TRC20: 'trx',
      ERC20: 'eth',
      BEP20: 'bnb'
    };
    const chain = chainMap[network as string] || 'trx';
    const result = await sdk.getDepositAddress({ chain });

    if (result?.data?.address) {
      return res.json({ code: 0, data: {
        address: result.data.address,
        network: network,
        qrCode: result.data.qrCode || ''
      }, timestamp: Date.now() });
    }

    return res.json({ code: 404, message: '未获取到充值地址', timestamp: Date.now() });
  } catch (err: any) {
    console.error('[DogPay] getDepositAddress error:', err.message);
    return res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

// ── 创建C2C买币订单（对接DogPay）────────────────────────────
router.post('/c2c/create', async (req, res) => {
  const { userId, amountUsdt, network = 'TRC20' } = req.body;
  if (!userId || !amountUsdt) return res.json({ code: 400, message: '参数缺失' });

  const sdk = await getDogPaySDK();
  if (!sdk) {
    return res.json({ code: 400, message: 'DogPay渠道未配置或未启用', timestamp: Date.now() });
  }

  try {
    // 调用DogPay C2C买币接口
    const result = await sdk.createC2COrder({
      amount: amountUsdt,
      token: 'USDT',
      network: network
    });

    if (result?.data?.orderId) {
      // 保存订单到本地数据库
      const orderNo = `DOGPAY${Date.now()}${Math.floor(Math.random()*1000)}`;
      const exchangeRate = 1.0;
      const amountUsd = amountUsdt * exchangeRate;

      const dbResult = db.prepare(`
        INSERT INTO usdt_orders (order_no,user_id,amount_usdt,amount_usd,exchange_rate,network,pay_address,status,dogpay_order_id,expire_at)
        VALUES (?,?,?,?,?,?,?,0,?,datetime('now', '+30 minutes'))
      `).run(orderNo, userId, amountUsdt, amountUsd, exchangeRate, network, result.data.payAddress || '', result.data.orderId);

      return res.json({ code: 0, data: {
        orderId: dbResult.lastInsertRowid,
        orderNo,
        dogpayOrderId: result.data.orderId,
        amountUsdt,
        amountUsd,
        network,
        payAddress: result.data.payAddress,
        qrCode: result.data.qrCode,
        expireAt: result.data.expireAt
      }, timestamp: Date.now() });
    }

    return res.json({ code: 400, message: result?.message || '创建订单失败', timestamp: Date.now() });
  } catch (err: any) {
    console.error('[DogPay] createC2COrder error:', err.message);
    return res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

// ── 查询充值订单详情（对接DogPay）────────────────────────────
router.get('/orders/:id/detail', async (req, res) => {
  const order = db.prepare('SELECT * FROM usdt_orders WHERE id=?').get(req.params.id) as any;
  if (!order) return res.json({ code: 404, message: '订单不存在' });

  const sdk = await getDogPaySDK();
  if (!sdk || !order.dogpay_order_id) {
    // 没有对接DogPay，直接返回本地订单信息
    return res.json({ code: 0, data: order, timestamp: Date.now() });
  }

  try {
    const result = await sdk.getC2COrderDetail(order.dogpay_order_id);
    return res.json({ code: 0, data: { ...order, dogpayStatus: result }, timestamp: Date.now() });
  } catch (err: any) {
    console.error('[DogPay] getC2COrderDetail error:', err.message);
    // 返回本地订单信息
    return res.json({ code: 0, data: order, timestamp: Date.now() });
  }
});

// ── 同步充值订单状态（对接DogPay）────────────────────────────
router.post('/orders/:id/sync', async (req, res) => {
  const order = db.prepare('SELECT * FROM usdt_orders WHERE id=?').get(req.params.id) as any;
  if (!order) return res.json({ code: 404, message: '订单不存在' });

  const sdk = await getDogPaySDK();
  if (!sdk || !order.dogpay_order_id) {
    return res.json({ code: 400, message: 'DogPay渠道未配置或无外部订单ID', timestamp: Date.now() });
  }

  try {
    const result = await sdk.getC2COrderDetail(order.dogpay_order_id);

    // 根据DogPay订单状态更新本地状态
    if (result?.data?.status) {
      let localStatus = order.status;
      if (result.data.status === 'completed' || result.data.status === 'success') {
        localStatus = 2; // 已确认
        db.prepare('UPDATE usdt_orders SET status=2,tx_hash=?,confirmed_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(result.data.txHash || '', req.params.id);
      }

      return res.json({ code: 0, message: '状态同步成功', data: { status: localStatus }, timestamp: Date.now() });
    }

    return res.json({ code: 400, message: '未获取到有效订单状态', timestamp: Date.now() });
  } catch (err: any) {
    console.error('[DogPay] sync order error:', err.message);
    return res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

// ── USDT 统计 ─────────────────────────────────────────────────
router.get('/stats', adminAuth, (req, res) => {
  const totalOrders   = (db.prepare('SELECT COUNT(*) as c FROM usdt_orders').get() as any).c;
  const confirmedAmt  = (db.prepare(`SELECT COALESCE(SUM(amount_usdt),0) as v FROM usdt_orders WHERE status=2`).get() as any).v;
  const pendingOrders = (db.prepare('SELECT COUNT(*) as c FROM usdt_orders WHERE status=0').get() as any).c;
  const todayAmt      = (db.prepare(`SELECT COALESCE(SUM(amount_usdt),0) as v FROM usdt_orders WHERE status=2 AND date(confirmed_at)=date('now')`).get() as any).v;
  res.json({ code: 0, data: { totalOrders, confirmedAmt, pendingOrders, todayAmt }, timestamp: Date.now() });
});

export default router;
