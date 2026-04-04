import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse, Card } from '../types';
import { sendEmail, cardOpenedTemplate, topupSuccessTemplate } from '../mail';
import { DogPaySDK } from '../channels/dogpay';

const router = Router();

// 获取 DogPay SDK 实例
async function getDogPaySDK() {
  const channel = db.prepare("SELECT * FROM card_channels WHERE channel_code = 'dogpay' AND status = 1").get() as any;
  if (!channel) return null;
  return new DogPaySDK({
    appId: channel.api_key,
    appSecret: channel.api_secret,
    apiBaseUrl: channel.api_base_url
  });
}

// 生成卡号
function generateCardNo(): { cardNo: string; masked: string } {
  const bin = '4111'; // Visa BIN
  const middle = String(Math.floor(Math.random() * 10000000000)).padStart(10, '0');
  const last4 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  const cardNo = `${bin}${middle}${last4}`;
  return { cardNo, masked: `****${last4}` };
}

// 生成CVV
function generateCVV(): string {
  return String(Math.floor(100 + Math.random() * 900));
}

// 生成过期日期 (1年后)
function generateExpireDate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().split('T')[0];
}

// 获取卡片列表
router.get('/', authMiddleware, (req: AuthRequest, res: Response<ApiResponse>) => {
  const { status } = req.query;
  
  let sql = 'SELECT id, card_no_masked, card_name, card_type, currency, balance, credit_limit, single_limit, daily_limit, status, expire_date, purpose, created_at FROM cards WHERE user_id = ?';
  const params: any[] = [req.user!.userId];
  
  if (status) {
    sql += ' AND status = ?';
    params.push(Number(status));
  }
  
  sql += ' ORDER BY created_at DESC';
  
  const cards = db.prepare(sql).all(...params);
  
  res.json({ code: 0, message: 'success', data: cards, timestamp: Date.now() });
});

// 开卡
router.post('/', authMiddleware, async (req: AuthRequest, res: Response<ApiResponse>) => {
  const { cardName, cardType, creditLimit, singleLimit, dailyLimit, purpose } = req.body;
  
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

  const sdk = await getDogPaySDK();
  if (sdk) {
    try {
      // 调用 DogPay 接口开卡
      const dogpayRes = await sdk.createCard({
        cardType: cardType === 'physical' ? 'physical' : 'virtual',
        cardName: cardName
      });
      
      if (dogpayRes && dogpayRes.data) {
        const cardData = dogpayRes.data;
        externalId = cardData.id;
        cardNo = cardData.idNo || ''; // 假设 idNo 是完整卡号，如果接口不返回则需后续 reveal
        masked = cardData.last4 ? `****${cardData.last4}` : '****';
        expireDate = cardData.createdAt ? new Date(cardData.createdAt).toISOString().split('T')[0] : generateExpireDate();
        cvv = '***'; // 初始设为掩码
      } else {
        return res.json({ code: 500, message: '渠道开卡失败: ' + (dogpayRes?.message || '未知错误'), timestamp: Date.now() });
      }
    } catch (err: any) {
      console.error('DogPay create card error:', err.message);
      return res.json({ code: 500, message: '渠道接口调用异常', timestamp: Date.now() });
    }
  } else {
    // 如果没有配置 DogPay 渠道，回退到模拟逻辑
    const mock = generateCardNo();
    cardNo = mock.cardNo;
    masked = mock.masked;
    cvv = generateCVV();
    expireDate = generateExpireDate();
  }
  
  const result = db.prepare(`
    INSERT INTO cards (card_no, card_no_masked, user_id, card_name, card_type, currency, balance, credit_limit, single_limit, daily_limit, status, expire_date, cvv, purpose, external_id)
    VALUES (?, ?, ?, ?, ?, 'USD', 0, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(cardNo, masked, req.user!.userId, cardName, cardType, creditLimit, singleLimit || null, dailyLimit || null, expireDate, cvv, purpose || null, externalId || null);
  
  // 获取用户邮箱
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user!.userId) as any;
  
  // 开卡成功 - 发送邮件通知
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
      creditLimit
    },
    timestamp: Date.now()
  });
});

// 获取卡片详情
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

// 揭示完整卡号/CVV
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

// 充值
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
  
  // 更新余额
  const newBalance = card.balance + amount;
  db.prepare('UPDATE cards SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newBalance, card.id);
  
  // 创建交易记录
  const txnNo = `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`;
  db.prepare(`
    INSERT INTO transactions (txn_no, card_id, user_id, txn_type, amount, currency, status, merchant_name, txn_time)
    VALUES (?, ?, ?, 'TOPUP', ?, 'USD', 1, '账户充值', CURRENT_TIMESTAMP)
  `).run(txnNo, card.id, req.user!.userId, amount);
  
  // 充值成功 - 发送邮件通知
  if (card.email) {
    sendEmail({
      to: card.email,
      subject: '💰 充值成功 - VCC虚拟卡系统',
      html: topupSuccessTemplate(card.card_no_masked, amount, newBalance)
    });
  }
  
  res.json({ code: 0, message: '充值成功', data: { newBalance }, timestamp: Date.now() });
});

// 冻结卡片
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

// 解冻卡片
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

// 销卡
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
  
  // 退回余额
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
