/**
 * 商户端 — 统一持卡人管理
 *
 * 功能：
 *   POST /api/v1/cardholders      — 创建统一持卡人，自动同步到 UQPAY+GEO
 *   GET  /api/v1/cardholders       — 查询当前用户持卡人及渠道同步状态
 *   POST /api/v1/cardholders/:id/sync — 重试同步失败渠道
 *
 * 不暴露渠道选择给前端。
 */
import { Router, Response } from 'express';
import crypto from 'crypto';
import db, { saveDatabase } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types';

const router = Router();

// ── 所有路由需登录 ──
router.use(authMiddleware);

// ── 校验规则 ──
const ALLOWED_COUNTRIES = ['USA', 'SG', 'HK'];
const MOBILE_PREFIX_MAP: Record<string, string> = { USA: '1', SG: '65', HK: '852' };

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return email;
  return email[0] + '***' + email.substring(at);
}

// ── 查询持卡人列表（中性返回，不暴露渠道信息） ──────────────────────

router.get('/', (req: AuthRequest, res: Response<ApiResponse>) => {
  const profiles = db.prepare(`
    SELECT id, first_name, last_name, email, phone, country_code, city, status, created_at
    FROM user_cardholder_profiles
    WHERE user_id = ?
    ORDER BY id DESC
  `).all(req.user!.userId) as any[];

  const data = profiles.map((p: any) => ({
    id: p.id,
    name: p.first_name + ' ' + p.last_name,
    emailMasked: p.email ? maskEmail(p.email) : '',
    phoneMasked: p.phone ? '****' + p.phone.slice(-4) : '',
    countryCode: p.country_code || '',
    city: p.city || '',
    status: p.status ? 'active' : 'inactive',
    createdAt: p.created_at || '',
  }));

  res.json({ code: 0, message: 'success', data, timestamp: Date.now() });
});

// ── 查询当前持卡人同步状态（中性返回，不暴露渠道） ──────────────────

router.get('/current', (req: AuthRequest, res: Response<ApiResponse>) => {
  const profiles = db.prepare(`
    SELECT p.* FROM user_cardholder_profiles p
    WHERE p.user_id = ?
    ORDER BY p.id DESC LIMIT 1
  `).get(req.user!.userId) as any;

  if (!profiles) {
    return res.json({
      code: 0,
      message: 'success',
      data: { profileId: 0, emailMasked: '', profileReady: false, canCreateCard: false },
      timestamp: Date.now(),
    });
  }

  const accounts = db.prepare(`
    SELECT sync_status FROM cardholder_channel_accounts
    WHERE profile_id = ?
  `).all(profiles.id) as any[];

  // 所有启用渠道均同步成功 → profileReady=true
  const allSuccess = accounts.length > 0 && accounts.every((a: any) => a.sync_status === 'success');

  res.json({
    code: 0,
    message: 'success',
    data: {
      profileId: profiles.id,
      emailMasked: profiles.email ? maskEmail(profiles.email) : '',
      profileReady: allSuccess,
      canCreateCard: allSuccess,
      message: allSuccess ? undefined : '持卡人资料未完成，请联系平台客服',
    },
    timestamp: Date.now(),
  });
});

// ── 创建持卡人（统一通用字段，不暴露渠道信息） ──────────────────────

router.post('/', async (req: AuthRequest, res: Response<ApiResponse>) => {
  const userId = req.user!.userId;

  // ── 校验 ──

  const {
    firstName, lastName, email, phone, mobilePrefix, birthDate,
    countryCode, state, city, addressLine1, addressLine2, postalCode,
  } = req.body;

  // ── 校验 ──
  const errors: string[] = [];
  if (!firstName || !firstName.trim()) errors.push('firstName 必填');
  if (!lastName || !lastName.trim()) errors.push('lastName 必填');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) errors.push('email 格式不正确');
  if (!phone) errors.push('phone 必填');
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate).trim())) errors.push('birthDate 格式必须为 YYYY-MM-DD');

  const cc = String(countryCode || 'USA').toUpperCase();
  if (!['USA', 'SG', 'HK'].includes(cc)) errors.push('国家仅支持 USA/SG/HK');
  if (!state || !String(state).trim()) errors.push('state 必填');
  if (!city || !String(city).trim()) errors.push('city 必填');
  if (!addressLine1 || !String(addressLine1).trim()) errors.push('addressLine1 必填');
  if (!postalCode || !String(postalCode).trim()) errors.push('postalCode 必填');

  if (errors.length > 0) {
    return res.json({ code: 400, message: errors.join('; '), timestamp: Date.now() });
  }

  const mp = String(mobilePrefix || '1').replace(/^\+/, '');
  const sanitizedEmail = email.trim();

  // ── 创建本地 profile（通用字段） ──
  const profileResult = db.prepare(`
    INSERT INTO user_cardholder_profiles
      (user_id, first_name, last_name, email, phone, mobile_prefix, birth_date,
       country_code, state, city, address_line1, address_line2, postal_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, firstName.trim(), lastName.trim(), sanitizedEmail, phone.trim(), mp, birthDate.trim(),
    cc, state.trim(), city.trim(), addressLine1.trim(), (addressLine2 || '').trim(), postalCode.trim(),
  );
  saveDatabase();
  const profileId = profileResult.lastInsertRowid as number;

  // ── 确认已启用渠道（内部逻辑，不暴露给前端） ──
  const channelCodes = db.prepare(
    "SELECT DISTINCT channel_code FROM card_channels WHERE UPPER(channel_code) IN ('UQPAY','GEO') AND status=1"
  ).all() as any[];
  const activeChannels: string[] = channelCodes.map((c: any) => c.channel_code.toUpperCase());

  let allSuccess = true;

  for (const chCode of activeChannels) {
    try {
      let providerId = '';

      if (chCode === 'UQPAY') {
        const { UqPaySDK } = await import('../channels/uqpay');
        const channel = db.prepare("SELECT * FROM card_channels WHERE UPPER(channel_code)='UQPAY' AND status=1").get() as any;
        if (!channel) continue;

        let config: Record<string, any> = {};
        try { config = JSON.parse(channel.config_json || '{}'); } catch (_) {}

        const sdk = new UqPaySDK({
          clientId: config.clientId || channel.api_key || '',
          apiKey: config.apiSecret || channel.api_secret || '',
          baseUrl: channel.api_base_url,
        });

        // UQPay adapter 从通用字段映射
        const result = await sdk.getOrCreateCardholder({
          userId,
          email: sanitizedEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          countryCode: cc === 'USA' ? 'US' : cc,
          phoneNumber: phone.trim(),
          database: null,
        });
        providerId = result.cardholder_id || result.id || '';

        if (providerId) {
          db.prepare(`
            INSERT OR REPLACE INTO uqpay_cardholders (user_id, uqpay_cardholder_id, email, phone_number, cardholder_status)
            VALUES (?, ?, ?, ?, 'SUCCESS')
          `).run(userId, providerId, sanitizedEmail, phone.trim());

          db.prepare(`
            INSERT OR REPLACE INTO cardholder_channel_accounts
              (profile_id, user_id, channel_code, provider_cardholder_id, provider_email, sync_status)
            VALUES (?, ?, 'UQPAY', ?, ?, 'success')
          `).run(profileId, userId, providerId, sanitizedEmail);
        }
      }

      if (chCode === 'GEO') {
        const { GeoSdk } = await import('../channels/geo');
        const channel = db.prepare("SELECT * FROM card_channels WHERE UPPER(channel_code)='GEO' AND status=1").get() as any;
        if (!channel) continue;

        let geoConfig: Record<string, any> = {};
        try { geoConfig = JSON.parse(channel.config_json || '{}'); } catch (_) {}

        const sdk = new GeoSdk({
          baseUrl: channel.api_base_url,
          userNo: geoConfig.userNo || '',
          privateKey: geoConfig.privateKey || '',
          geoPublicKey: geoConfig.geoPublicKey || '',
          customerPublicKey: geoConfig.customerPublicKey || '',
        });

        const cardUserId = 'GEOU' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase();

        // GEO adapter 从通用字段映射
        const result = await sdk.createCardholder({
          userReqNo: crypto.randomUUID(),
          cardUserId,
          mobile: phone.trim(),
          mobilePrefix: mp,
          email: sanitizedEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthDate: birthDate.trim(),
          billingCity: city.trim(),
          billingState: state.trim(),
          billingCountry: cc,
          billingAddress: addressLine1.trim() + (addressLine2 ? ' ' + addressLine2.trim() : ''),
          billingZipCode: postalCode.trim(),
          countryCode: cc,
        });

        providerId = result.cardUserId || cardUserId;

        if (providerId) {
          geoConfig.geoCardUserIds = geoConfig.geoCardUserIds || {};
          geoConfig.geoCardUserIds[String(userId)] = providerId;
          db.prepare("UPDATE card_channels SET config_json = ?, updated_at = datetime('now') WHERE channel_code = 'GEO'")
            .run(JSON.stringify(geoConfig));

          db.prepare(`
            INSERT OR REPLACE INTO cardholder_channel_accounts
              (profile_id, user_id, channel_code, provider_cardholder_id, provider_email, sync_status)
            VALUES (?, ?, 'GEO', ?, ?, 'success')
          `).run(profileId, userId, providerId, sanitizedEmail);
        }
      }
    } catch (err: any) {
      allSuccess = false;
      const msg = (err.message || '').slice(0, 300);
      console.error('[Cardholder] 内部同步失败: userId=' + userId + ' channel=' + chCode + ' error=' + msg);

      db.prepare(`
        INSERT OR REPLACE INTO cardholder_channel_accounts
          (profile_id, user_id, channel_code, provider_cardholder_id, provider_email, sync_status, last_error)
        VALUES (?, ?, ?, '', ?, 'failed', ?)
      `).run(profileId, userId, chCode, sanitizedEmail, msg);
    }
  }

  saveDatabase();

  res.json({
    code: 0,
    message: '持卡人创建成功',
    data: {
      id: profileId,
      name: firstName.trim() + ' ' + lastName.trim(),
      emailMasked: maskEmail(sanitizedEmail),
      status: 'active',
    },
    timestamp: Date.now(),
  });
});

// ── 重试同步 ───────────────────────────────────────────────────────────────

router.post('/:id/sync', async (req: AuthRequest, res: Response<ApiResponse>) => {
  const profileId = Number(req.params.id);
  const profile = db.prepare("SELECT * FROM user_cardholder_profiles WHERE id=? AND user_id=?")
    .get(profileId, req.user!.userId) as any;
  if (!profile) {
    return res.json({ code: 404, message: '持卡人不存在', timestamp: Date.now() });
  }

  const userId = req.user!.userId;
  const pending = db.prepare(`
    SELECT channel_code, provider_email FROM cardholder_channel_accounts
    WHERE profile_id=? AND sync_status!='success'
  `).all(profileId) as any[];

  // 如果有渠道未在映射表中（例如之前同步时就失败了，表中没有记录）
  const existingChannels = db.prepare(
    "SELECT DISTINCT channel_code FROM cardholder_channel_accounts WHERE profile_id=?"
  ).all(profileId) as any[];
  const existingSet = new Set(existingChannels.map((c: any) => c.channel_code));
  const allActive = db.prepare(
    "SELECT DISTINCT channel_code FROM card_channels WHERE UPPER(channel_code) IN ('UQPAY','GEO') AND status=1"
  ).all() as any[];
  for (const ac of allActive) {
    if (!existingSet.has(ac.channel_code.toUpperCase())) {
      pending.push({ channel_code: ac.channel_code.toUpperCase(), provider_email: profile.email });
    }
  }

  // 同步失败的 profile 直接视为 pending
  if (pending.length === 0) {
    return res.json({ code: 0, message: '持卡人资料已完成', timestamp: Date.now() });
  }

  let syncDone = false;

  for (const p of pending) {
    const chCode = p.channel_code.toUpperCase();
    try {
      let providerId = '';

      if (chCode === 'UQPAY') {
        const { UqPaySDK } = await import('../channels/uqpay');
        const channel = db.prepare("SELECT * FROM card_channels WHERE UPPER(channel_code)='UQPAY' AND status=1").get() as any;
        if (!channel) continue;
        let config: Record<string, any> = {};
        try { config = JSON.parse(channel.config_json || '{}'); } catch (_) {}
        const sdk = new UqPaySDK({
          clientId: config.clientId || channel.api_key || '',
          apiKey: config.apiSecret || channel.api_secret || '',
          baseUrl: channel.api_base_url,
        });
        const result = await sdk.getOrCreateCardholder({
          userId, email: profile.email, firstName: profile.first_name, lastName: profile.last_name,
          countryCode: profile.country_code === 'USA' ? 'US' : profile.country_code,
          phoneNumber: profile.phone, database: null,
        });
        providerId = result.cardholder_id || result.id || '';
      }

      if (chCode === 'GEO') {
        const { GeoSdk } = await import('../channels/geo');
        const channel = db.prepare("SELECT * FROM card_channels WHERE UPPER(channel_code)='GEO' AND status=1").get() as any;
        if (!channel) continue;
        let geoConfig: Record<string, any> = {};
        try { geoConfig = JSON.parse(channel.config_json || '{}'); } catch (_) {}
        const sdk = new GeoSdk({
          baseUrl: channel.api_base_url, userNo: geoConfig.userNo || '',
          privateKey: geoConfig.privateKey || '', geoPublicKey: geoConfig.geoPublicKey || '',
          customerPublicKey: geoConfig.customerPublicKey || '',
        });
        const cardUserId = 'GEOU' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase();
        const result = await sdk.createCardholder({
          userReqNo: crypto.randomUUID(), cardUserId,
          mobile: profile.phone, mobilePrefix: profile.mobile_prefix || '1',
          email: profile.email, firstName: profile.first_name, lastName: profile.last_name,
          birthDate: profile.birth_date || '1990-01-01',
          billingCity: profile.city || 'Los Angeles', billingState: profile.state || 'CA',
          billingCountry: profile.country_code || 'USA',
          billingAddress: profile.address_line1 || 'Default',
          billingZipCode: profile.postal_code || '90012', countryCode: profile.country_code || 'USA',
        });
        providerId = result.cardUserId || cardUserId;
      }

      if (providerId) {
        db.prepare(`
          INSERT OR REPLACE INTO cardholder_channel_accounts
            (profile_id, user_id, channel_code, provider_cardholder_id, provider_email, sync_status)
          VALUES (?, ?, ?, ?, ?, 'success')
        `).run(profileId, req.user!.userId, chCode, providerId, profile.email);
        syncDone = true;
      }
    } catch (err: any) {
      console.error('[Cardholder] 同步失败: userId=' + userId + ' error=' + (err.message || '').slice(0, 200));
    }
  }

  saveDatabase();

  const finalStatus = db.prepare(`
    SELECT COUNT(*) as failed FROM cardholder_channel_accounts
    WHERE profile_id=? AND sync_status!='success'
  `).get(profileId) as any;
  const allSuccess = !finalStatus || finalStatus.failed === 0;

  res.json({
    code: 0,
    message: allSuccess ? '持卡人资料已完成' : '持卡人资料未完成，请联系平台客服',
    timestamp: Date.now(),
  });
});

export default router;
