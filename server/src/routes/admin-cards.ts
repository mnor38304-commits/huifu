import { Router } from 'express';
import db from '../db';
import { adminAuth } from './admin-auth';
import { DogPaySDK } from '../channels/dogpay';
import { syncDogPayBins } from '../dogpay-bin-store';

const router = Router();

router.get('/bins', adminAuth, (req, res) => {
  try {
    const { page = 1, pageSize = 20, status } = req.query;
    let sql = 'SELECT b.*, (SELECT COUNT(*) FROM cards WHERE bin_id=b.id) as card_count FROM card_bins b WHERE 1=1';
    const params: any[] = [];
    if (status !== undefined && status !== '') { sql += ' AND b.status=?'; params.push(Number(status)); }
    const total = (db.prepare(sql.replace('SELECT b.*, (SELECT COUNT(*) FROM cards WHERE bin_id=b.id) as card_count FROM card_bins b', 'SELECT COUNT(*) as c FROM card_bins b')).get() as any).c;
    sql += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), (Number(page)-1)*Number(pageSize));
    const list = db.prepare(sql).all(...params);
    res.json({ code: 0, data: { list, total }, timestamp: Date.now() });
  } catch (err: any) {
    console.error('BIN list error:', err.message);
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.post('/bins', adminAuth, (req: any, res) => {
  try {
    const { binCode, binName, cardBrand, issuer, currency, country,
      openFee, topupFeeRate, topupFeeMin, crossBorderFeeRate,
      smallTxnThreshold, smallTxnFee, declineFee, authFee, refundFeeRate, monthlyFee } = req.body;
    if (!binCode || !binName) return res.json({ code: 400, message: '请填写BIN码和名称' });
    const result = db.prepare(`INSERT INTO card_bins (bin_code,bin_name,card_brand,issuer,currency,country,open_fee,topup_fee_rate,topup_fee_min,cross_border_fee_rate,small_txn_threshold,small_txn_fee,decline_fee,auth_fee,refund_fee_rate,monthly_fee) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(binCode, binName, cardBrand||'VISA', issuer||'', currency||'USD', country||'US', openFee||0, topupFeeRate||0.015, topupFeeMin||0, crossBorderFeeRate||0.015, smallTxnThreshold||1, smallTxnFee||0.1, declineFee||0.5, authFee||0, refundFeeRate||0, monthlyFee||1.0);
    res.json({ code: 0, message: 'BIN创建成功', data: { id: result.lastInsertRowid }, timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.put('/bins/:id', adminAuth, (req: any, res) => {
  try {
    const { binName, cardBrand, issuer, currency, country, status,
      openFee, topupFeeRate, topupFeeMin, crossBorderFeeRate,
      smallTxnThreshold, smallTxnFee, declineFee, authFee, refundFeeRate, monthlyFee } = req.body;
    db.prepare(`UPDATE card_bins SET bin_name=?,card_brand=?,issuer=?,currency=?,country=?,status=?,open_fee=?,topup_fee_rate=?,topup_fee_min=?,cross_border_fee_rate=?,small_txn_threshold=?,small_txn_fee=?,decline_fee=?,auth_fee=?,refund_fee_rate=?,monthly_fee=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(binName, cardBrand, issuer, currency, country, status, openFee, topupFeeRate, topupFeeMin, crossBorderFeeRate, smallTxnThreshold, smallTxnFee, declineFee, authFee, refundFeeRate, monthlyFee, req.params.id);
    res.json({ code: 0, message: '更新成功', timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.post('/bins/batch-rates', adminAuth, (req: any, res) => {
  try {
    const { ids, rates } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.json({ code: 400, message: '请选择至少一个BIN', timestamp: Date.now() });
    }
    const allowedMap: Record<string, string> = {
      openFee: 'open_fee',
      topupFeeRate: 'topup_fee_rate',
      topupFeeMin: 'topup_fee_min',
      crossBorderFeeRate: 'cross_border_fee_rate',
      smallTxnThreshold: 'small_txn_threshold',
      smallTxnFee: 'small_txn_fee',
      declineFee: 'decline_fee',
      authFee: 'auth_fee',
      refundFeeRate: 'refund_fee_rate',
      monthlyFee: 'monthly_fee',
    };
    const setClauses: string[] = [];
    const params: any[] = [];
    Object.keys(allowedMap).forEach((key) => {
      if (rates && rates[key] !== undefined && rates[key] !== null && rates[key] !== '') {
        setClauses.push(`${allowedMap[key]} = ?`);
        params.push(Number(rates[key]));
      }
    });
    if (!setClauses.length) {
      return res.json({ code: 400, message: '请至少填写一个费率字段', timestamp: Date.now() });
    }
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    const placeholders = ids.map(() => '?').join(',');
    params.push(...ids.map((id: any) => Number(id)));
    db.prepare(`UPDATE card_bins SET ${setClauses.join(', ')} WHERE id IN (${placeholders})`).run(...params);
    return res.json({ code: 0, message: '批量费率更新成功', data: { updated: ids.length }, timestamp: Date.now() });
  } catch (err: any) {
    return res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

// 获取单个渠道的可用BIN列表（实时从渠道API拉取，不写库）
router.get('/channels/:id/bins', adminAuth, async (req: any, res) => {
  try {
    const channel = db.prepare('SELECT * FROM card_channels WHERE id = ?').get(Number(req.params.id)) as any;
    if (!channel) return res.json({ code: 404, message: '渠道不存在', timestamp: Date.now() });
    if (!channel.api_key) return res.json({ code: 400, message: '渠道未配置 API Key，请先完成渠道配置', timestamp: Date.now() });

    if (channel.channel_code === 'dogpay') {
      const sdk = new DogPaySDK({
        appId: channel.api_key,
        appSecret: channel.api_secret,
        apiBaseUrl: channel.api_base_url,
      });
      const payload = await sdk.getCardBins();
      // 兼容多种响应结构
      let list: any[] = [];
      if (Array.isArray(payload)) list = payload;
      else if (Array.isArray(payload?.data)) list = payload.data;
      else if (Array.isArray(payload?.data?.list)) list = payload.data.list;
      else if (Array.isArray(payload?.data?.records)) list = payload.data.records;
      else if (Array.isArray(payload?.list)) list = payload.list;
      return res.json({ code: 0, data: { list, total: list.length, channelCode: channel.channel_code }, timestamp: Date.now() });
    }

    return res.json({ code: 400, message: `暂不支持渠道 "${channel.channel_name}" 的BIN获取`, timestamp: Date.now() });
  } catch (err: any) {
    console.error('Get channel bins error:', err.message);
    return res.json({ code: 500, message: err.response?.data?.message || err.message, timestamp: Date.now() });
  }
});

// 同步单个渠道的BIN到数据库
router.post('/channels/:id/sync-bins', adminAuth, async (req: any, res) => {
  try {
    const channel = db.prepare('SELECT * FROM card_channels WHERE id = ?').get(Number(req.params.id)) as any;
    if (!channel) return res.json({ code: 404, message: '渠道不存在', timestamp: Date.now() });
    if (channel.status !== 1) return res.json({ code: 400, message: '渠道已禁用，请先启用', timestamp: Date.now() });
    if (!channel.api_key) return res.json({ code: 400, message: '渠道未配置 API Key，请先完成渠道配置', timestamp: Date.now() });

    if (channel.channel_code === 'dogpay') {
      const sdk = new DogPaySDK({
        appId: channel.api_key,
        appSecret: channel.api_secret,
        apiBaseUrl: channel.api_base_url,
      });
      const result = await syncDogPayBins(sdk);
      return res.json({ code: 0, message: `同步成功，共同步 ${result.synced} 个BIN`, data: result, timestamp: Date.now() });
    }

    return res.json({ code: 400, message: `暂不支持渠道 "${channel.channel_name}" 的BIN同步`, timestamp: Date.now() });
  } catch (err: any) {
    console.error('Sync channel bins error:', err.message);
    return res.json({ code: 500, message: err.response?.data?.message || err.message, timestamp: Date.now() });
  }
});

router.post('/channels/dogpay/sync-bins', adminAuth, async (req: any, res) => {
  try {
    const channel = db.prepare("SELECT * FROM card_channels WHERE channel_code = 'dogpay' AND status = 1").get() as any;
    if (!channel) {
      return res.json({ code: 400, message: 'DogPay 渠道未配置或未启用', timestamp: Date.now() });
    }
    const sdk = new DogPaySDK({ appId: channel.api_key, appSecret: channel.api_secret, apiBaseUrl: channel.api_base_url });
    const result = await syncDogPayBins(sdk);
    return res.json({ code: 0, message: 'DogPay BIN 同步成功', data: result, timestamp: Date.now() });
  } catch (err: any) {
    return res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

// 同步所有已启用渠道的卡段
router.post('/channels/sync-all-bins', adminAuth, async (req: any, res) => {
  try {
    const channels = db.prepare("SELECT * FROM card_channels WHERE status = 1").all() as any[];
    if (!channels.length) {
      return res.json({ code: 400, message: '没有已启用的渠道', timestamp: Date.now() });
    }

    const results: any[] = [];

    for (const channel of channels) {
      try {
        if (channel.channel_code === 'dogpay') {
          const sdk = new DogPaySDK({ 
            appId: channel.api_key, 
            appSecret: channel.api_secret, 
            apiBaseUrl: channel.api_base_url 
          });
          const result = await syncDogPayBins(sdk);
          results.push({
            channelCode: channel.channel_code,
            channelName: channel.channel_name,
            success: true,
            ...result
          });
        }
        // 可以在这里添加其他渠道的同步逻辑
      } catch (err: any) {
        results.push({
          channelCode: channel.channel_code,
          channelName: channel.channel_name,
          success: false,
          error: err.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    return res.json({ 
      code: 0, 
      message: `同步完成：${successCount} 个成功，${failCount} 个失败`, 
      data: { results, successCount, failCount, total: results.length },
      timestamp: Date.now() 
    });
  } catch (err: any) {
    return res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.get('/cards', adminAuth, (req, res) => {
  try {
    const { page = 1, pageSize = 20, keyword, status, userId } = req.query;
    let sql = `SELECT c.*, u.phone, u.email, u.user_no, b.bin_name, b.bin_code FROM cards c LEFT JOIN users u ON c.user_id=u.id LEFT JOIN card_bins b ON c.bin_id=b.id WHERE 1=1`;
    const params: any[] = [];
    if (keyword) { sql += ` AND (c.card_no_masked LIKE ? OR c.card_name LIKE ? OR u.phone LIKE ?)`; params.push(`%${keyword}%`,`%${keyword}%`,`%${keyword}%`); }
    if (status !== undefined && status !== '') { sql += ` AND c.status=?`; params.push(Number(status)); }
    if (userId) { sql += ` AND c.user_id=?`; params.push(Number(userId)); }
    const total = (db.prepare(sql.replace(/SELECT c\.\*.*?FROM cards c/, 'SELECT COUNT(*) as c FROM cards c')).get(...params) as any).c;
    sql += ` ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(pageSize), (Number(page)-1)*Number(pageSize));
    const list = db.prepare(sql).all(...params);
    res.json({ code: 0, data: { list, total }, timestamp: Date.now() });
  } catch (err: any) {
    console.error('Card list error:', err.message);
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.post('/cards/:id/status', adminAuth, (req: any, res) => {
  try {
    const { status, reason } = req.body;
    db.prepare('UPDATE cards SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
    res.json({ code: 0, message: '操作成功', timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.get('/channels', adminAuth, (req, res) => {
  try {
    const list = db.prepare('SELECT id,channel_code,channel_name,api_base_url,status,created_at FROM card_channels').all();
    res.json({ code: 0, data: list, timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.post('/channels', adminAuth, (req: any, res) => {
  try {
    const { channelCode, channelName, apiBaseUrl, apiKey, apiSecret, webhookSecret, configJson } = req.body;
    const result = db.prepare(`INSERT INTO card_channels (channel_code,channel_name,api_base_url,api_key,api_secret,webhook_secret,config_json) VALUES (?,?,?,?,?,?,?)`)
      .run(channelCode, channelName, apiBaseUrl, apiKey, apiSecret, webhookSecret, configJson||'{}');
    res.json({ code: 0, message: '渠道创建成功', data: { id: result.lastInsertRowid }, timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.put('/channels/:id', adminAuth, (req: any, res) => {
  try {
    const { channelName, apiBaseUrl, apiKey, apiSecret, webhookSecret, status, configJson } = req.body;
    db.prepare(`UPDATE card_channels SET channel_name=?,api_base_url=?,api_key=?,api_secret=?,webhook_secret=?,status=?,config_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(channelName, apiBaseUrl, apiKey, apiSecret, webhookSecret, status, configJson, req.params.id);
    res.json({ code: 0, message: '更新成功', timestamp: Date.now() });
  } catch (err: any) {
    res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

export default router
