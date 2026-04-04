import { Router, Response } from 'express';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse, Card } from '../types';
import { sendEmail, cardOpenedTemplate, topupSuccessTemplate } from '../mail';
import { DogPaySDK } from '../channels/dogpay';
import { ensureDogPayBinSchema, getAvailableDogPayBins, getDogPayBinById } from '../dogpay-bin-store';

const router = Router();

async function getDogPaySDK() {
  const channel = db.prepare("SELECT * FROM card_channels WHERE channel_code = 'dogpay' AND status = 1").get() as any;
  if (!channel) return null;
  return new DogPaySDK({
    appId: channel.api_key,
    appSecret: channel.api_secret,
    apiBaseUrl: channel.api_base_url
  });
}

function generateCardNo(binCode?: string): { cardNo: string; masked: string } {
  const bin = String(binCode || '411111').slice(0, 6).padEnd(6, '1');
  const middle = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  const last2 = String(Math.floor(Math.random() * 100)).padStart(2, '0');
  const cardNo = `${bin}${middle}${last2}`;
  return { cardNo, masked: `****${cardNo.slice(-4)}` };
}

function generateCVV(): string {
  return String(Math.floor(100 + Math.random() * 900));
}

function generateExpireDate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().split('T')[0];
}

router.get('/bins/available', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  try {
    ensureDogPayBinSchema();
    const sdk = await getDogPaySDK();

    if (sdk) {
      const dogpayBins = getAvailableDogPayBins();
      return res.json({ code: 0, message: 'success', data: dogpayBins, timestamp: Date.now() });
    }

    const bins = db.prepare(`
      SELECT id, bin_code, bin_name, card_brand, issuer, currency, country, status
      FROM card_bins
      WHERE status = 1
      ORDER BY id ASC
    `).all();

    return res.json({ code: 0, message: 'success', data: bins, timestamp: Date.now() });
  } catch (err: any) {
    console.error('Available bins error:', err.message);
    return res.json({ code: 500, message: err.message, timestamp: Date.now() });
  }
});

router.get('/', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const { status } = req.query;

  let sql = 'SELECT id, card_no_masked, card_name, card_type, currency, balance, credit_limit, single_limit, daily_limit, status, expire_date, purpose, created_at, bin_id FROM cards WHERE user_id = ?';
  const params: any[] = [req.user!.userId];

  if (status) {
    sql += ' AND status = ?';
    params.push(Number(status));
  }

  sql += ' ORDER BY created_at DESC';

  const cards = db.prepare(sql).all(...params);

  res.json({ code: 0, message: 'success', data: cards, timestamp: Date.now() });
});

router.post('/', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { cardName, cardType, creditLimit, singleLimit, dailyLimit, purpose, binId } = req.body;

  if (!cardName || !cardType || !creditLimit) {
    return res.json({ code: 400, message: '请填写完整信息', timestamp: Date.now() });
  }

  if (creditLimit < 10 || creditLimit > 10000) {
    return res.json({ code: 400, message: '额度范围: $10 - $10,000', timestamp: Date.now() });
  }

  let cardNo = '';
  let masked = '';
  let cvv = '';
  let expireDate = '';
  let externalId = '';
  let selectedBinId: number | null = null;
  let selectedBinCode: string | null = null;

  const sdk = await getDogPaySDK();
  if (sdk) {
    try {
      ensureDogPayBinSchema();
      const selectedBin = binId ? getDogPayBinById(Number(binId)) : getAvailableDogPayBins()[0];

      if (!selectedBin?.external_bin_id) {
        return res.json({ code: 400, message: '暂无可用 DogPay 卡BIN，请先同步 BIN', timestamp: Date.now() });
      }

      selectedBinId = selectedBin.id;
      selectedBinCode = selectedBin.bin_code;

      const dogpayRes = await sdk.createCard({
        cardType: cardType === 'physical' ? 'physical' : 'virtual',
        cardName,
        channelId: selectedBin.external_bin_id
      });

      if (dogpayRes && dogpayRes.data) {
        const cardData = dogpayRes.data;
        externalId = cardData.id;
        cardNo = cardData.idNo || '';
        masked = cardData.last4 ? `****${cardData.last4}` : '****';
        expireDate = cardData.createdAt ? new Date(cardData.createdAt).toISOString().split('T')[0] : generateExpireDate();
        cvv = '***';
      } else {
        return res.json({ code: 500, message: '渠道开卡失败: ' + (dogpayRes?.message || '未知错误'), timestamp: Date.now() });
      }
    } catch (err: any) {
      console.error('DogPay create card error:', err.message);
      return res.json({ code: 500, message: '渠道接口调用异常', timestamp: Date.now() });
    }
  } else {
    const selectedBin = binId
      ? db.prepare('SELECT id, bin_code FROM card_bins WHERE id = ? AND status = 1').get(Number(binId)) as any
      : db.prepare('SELECT id, bin_code FROM card_bins WHERE status = 1 ORDER BY id ASC LIMIT 1').get() as any;

    if (selectedBin) {
      selectedBinId = selectedBin.id;
      selectedBinCode = selectedBin.bin_code;
    }

    const mock = generateCardNo(selectedBinCode || undefined);
    cardNo = mock.cardNo;
    masked = mock.masked;
    cvv = generateCVV();
    expireDate = generateExpireDate();
  }

  const result = db.prepare(`
    INSERT INTO cards (card_no, card_no_masked, user_id, bin_id, card_name, card_type, currency, balance, credit_limit, single_limit, daily_limit, status, expire_date, cvv, purpose, external_id)
    VALUES (?, ?, ?, ?, ?, ?, 'USD', 0, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(cardNo, masked, req.user!.userId, selectedBinId, cardName, cardType, creditLimit, singleLimit || null, dailyLimit || null, expireDate, cvv, purpose || null, externalId || null);

  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user!.userId) as any;

  if (user?.email) {
    sendEmail({
      to: user.email,
      subject: '💳 开卡成功 - VCC虚拟卡系统',
      html: cardOpenedTemplate(masked, cardName, creditLimit)
    });
  }

  res.json({
    code: 0,
    message: '开卡成功',
    data: {
      id: result.lastInsertRowid,
      cardNoMasked: masked,
      cvv: '***',
      expireDate,
      cardName,
      cardType,
      creditLimit,
      binId: selectedBinId
    },
    timestamp: Date.now()
  });
});

router.get('/:id', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare(`
    SELECT id, card_no_masked, card_name, card_type, currency, balance, credit_limit, single_limit, daily_limit, status, expire_date, purpose, created_at
    FROM cards WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user!.userId);

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  res.json({ code: 0, message: 'success', data: card, timestamp: Date.now() });
});

router.get('/:id/reveal', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare('SELECT card_no, cvv, expire_date FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId) as Card | undefined;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  res.json({
    code: 0,
    message: 'success',
    data: {
      cardNo: card.card_no,
      cvv: card.cvv,
      expireDate: card.expire_date
    },
    timestamp: Date.now()
  });
});

router.post('/:id/topup', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.json({ code: 400, message: '请输入有效金额', timestamp: Date.now() });
  }

  const card = db.prepare('SELECT c.*, u.email FROM cards c LEFT JOIN users u ON c.user_id = u.id WHERE c.id = ? AND c.user_id = ?').get(req.params.id, req.user!.userId) as (Card & { email?: string }) | undefined;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.status !== 1) {
    return res.json({ code: 400, message: '卡片状态异常', timestamp: Date.now() });
  }

  const newBalance = card.balance + amount;
  db.prepare('UPDATE cards SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newBalance, card.id);

  const txnNo = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
  db.prepare(`
    INSERT INTO transactions (txn_no, card_id, user_id, txn_type, amount, currency, status, merchant_name, txn_time)
    VALUES (?, ?, ?, 'TOPUP', ?, 'USD', 1, '账户充值', CURRENT_TIMESTAMP)
  `).run(txnNo, card.id, req.user!.userId, amount);

  if (card.email) {
    sendEmail({
      to: card.email,
      subject: '💰 充值成功 - VCC虚拟卡系统',
      html: topupSuccessTemplate(card.card_no_masked, amount, newBalance)
    });
  }

  res.json({ code: 0, message: '充值成功', data: { newBalance }, timestamp: Date.now() });
});

router.post('/:id/freeze', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId) as any;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.external_id) {
    const sdk = await getDogPaySDK();
    if (sdk) {
      try {
        await sdk.freezeCard(card.external_id);
      } catch (err: any) {
        return res.json({ code: 500, message: '渠道冻结失败: ' + err.message, timestamp: Date.now() });
      }
    }
  }

  db.prepare('UPDATE cards SET status = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

  res.json({ code: 0, message: '卡片已冻结', timestamp: Date.now() });
});

router.post('/:id/unfreeze', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId) as any;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.external_id) {
    const sdk = await getDogPaySDK();
    if (sdk) {
      try {
        await sdk.unfreezeCard(card.external_id);
      } catch (err: any) {
        return res.json({ code: 500, message: '渠道解冻失败: ' + err.message, timestamp: Date.now() });
      }
    }
  }

  db.prepare('UPDATE cards SET status = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

  res.json({ code: 0, message: '卡片已解冻', timestamp: Date.now() });
});

router.post('/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.userId) as any;

  if (!card) {
    return res.json({ code: 404, message: '卡片不存在', timestamp: Date.now() });
  }

  if (card.external_id) {
    const sdk = await getDogPaySDK();
    if (sdk) {
      try {
        await sdk.deleteCard(card.external_id);
      } catch (err: any) {
        return res.json({ code: 500, message: '渠道销卡失败: ' + err.message, timestamp: Date.now() });
      }
    }
  }

  if (card.balance > 0) {
    const txnNo = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
    db.prepare(`
      INSERT INTO transactions (txn_no, card_id, user_id, txn_type, amount, currency, status, merchant_name, txn_time)
      VALUES (?, ?, ?, 'CANCEL_REFUND', ?, 'USD', 1, '销卡退款', CURRENT_TIMESTAMP)
    `).run(txnNo, card.id, req.user!.userId, card.balance);
  }

  db.prepare('UPDATE cards SET status = 4, balance = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

  res.json({ code: 0, message: '卡片已注销', timestamp: Date.now() });
});

export default router;
