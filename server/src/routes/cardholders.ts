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

// ── 查询持卡人 ─────────────────────────────────────────────────────────────

router.get('/', (req: AuthRequest, res: Response<ApiResponse>) => {
  const profiles = db.prepare(`
    SELECT p.* FROM user_cardholder_profiles p
    WHERE p.user_id = ?
    ORDER BY p.id DESC LIMIT 1
  `).get(req.user!.userId) as any;

  if (!profiles) {
    return res.json({ code: 0, message: 'success', data: null, timestamp: Date.now() });
  }

  const accounts = db.prepare(`
    SELECT channel_code, provider_cardholder_id, provider_email, sync_status, last_error
    FROM cardholder_channel_accounts
    WHERE profile_id = ?
  `).all(profiles.id) as any[];

  const channels = accounts.map((a: any) => ({
    channelCode: a.channel_code,
    cardholderIdLast4: a.provider_cardholder_id ? a.provider_cardholder_id.slice(-4) : '',
    providerEmail: a.provider_email ? maskEmail(a.provider_email) : '',
    syncStatus: a.sync_status,
    lastError: a.last_error || '',
  }));

  res.json({
    code: 0,
    message: 'success',
    data: {
      profileId: profiles.id,
      email: profiles.email ? maskEmail(profiles.email) : '',
      channels,
    },
    timestamp: Date.now(),
  });
});

// ── 创建持卡人 ─────────────────────────────────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response<ApiResponse>) => {
  const userId = req.user!.userId;

  // 校验已存在
  const existing = db.prepare(
    "SELECT id FROM user_cardholder_profiles WHERE user_id = ?"
  ).get(userId) as any;
  if (existing) {
    return res.json({ code: 400, message: '您已创建过持卡人', timestamp: Date.now() });
  }

  const {
    firstName, lastName, email, phone, birthDate,
    // UQPay SG 地址
    uqpayAddressLine1, uqpayCity, uqpayState, uqpayPostalCode,
    // GEO USA/HK 地址
    geoCountryCode, geoBillingState, geoBillingCity, geoBillingAddress, geoBillingZipCode,
  } = req.body;

  // ── 校验 ──
  const errors: string[] = [];

  // 基础身份
  if (!firstName || !firstName.trim()) errors.push('firstName 必填');
  if (!lastName || !lastName.trim()) errors.push('lastName 必填');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) errors.push('email 格式不正确');
  if (!phone) errors.push('phone 必填');
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate).trim())) errors.push('birthDate 格式必须为 YYYY-MM-DD');

  // UQPay 地址：国家固定 SG
  if (!uqpayAddressLine1 || !String(uqpayAddressLine1).trim()) errors.push('uqpayAddressLine1 必填');
  if (!uqpayCity || !String(uqpayCity).trim()) errors.push('uqpayCity 必填');
  if (!uqpayState || !String(uqpayState).trim()) errors.push('uqpayState 必填');

  // GEO 地址
  const geoCc = String(geoCountryCode || 'USA').toUpperCase();
  if (!['USA', 'HK'].includes(geoCc)) errors.push('geoCountryCode 仅支持 USA 或 HK');
  if (!geoBillingState || !String(geoBillingState).trim()) errors.push('geoBillingState 必填');
  if (!geoBillingCity || !String(geoBillingCity).trim()) errors.push('geoBillingCity 必填');
  if (!geoBillingAddress || !String(geoBillingAddress).trim()) errors.push('geoBillingAddress 必填');
  if (!geoBillingZipCode || !String(geoBillingZipCode).trim()) errors.push('geoBillingZipCode 必填');

  if (errors.length > 0) {
    return res.json({ code: 400, message: errors.join('; '), timestamp: Date.now() });
  }

  const geoMp = geoCc === 'HK' ? '852' : '1';
  const sanitizedEmail = email.trim();

  // ── 创建本地 profile（只保存基础身份） ──
  const profileResult = db.prepare(`
    INSERT INTO user_cardholder_profiles
      (user_id, first_name, last_name, email, phone, birth_date, country_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, firstName.trim(), lastName.trim(), sanitizedEmail, phone.trim(), birthDate.trim(), 'USA',
  );
  saveDatabase();
  const profileId = profileResult.lastInsertRowid as number;

  // ── 确认已启用渠道 ──
  const channelCodes = db.prepare(
    "SELECT DISTINCT channel_code FROM card_channels WHERE UPPER(channel_code) IN ('UQPAY','GEO') AND status=1"
  ).all() as any[];
  const activeChannels: string[] = channelCodes.map((c: any) => c.channel_code.toUpperCase());

  interface SyncResult { channelCode: string; success: boolean; providerCardholderIdLast4?: string; error?: string }
  const syncResults: SyncResult[] = [];

  for (const chCode of activeChannels) {
    try {
      let providerId = '';

      if (chCode === 'UQPAY') {
        const { UqPaySDK } = await import('../channels/uqpay');
        const channel = db.prepare("SELECT * FROM card_channels WHERE UPPER(channel_code)='UQPAY' AND status=1").get() as any;
        if (!channel) throw new Error('UQPay 渠道未启用');

        let config: Record<string, any> = {};
        try { config = JSON.parse(channel.config_json || '{}'); } catch (_) {}

        const sdk = new UqPaySDK({
          clientId: config.clientId || channel.api_key || '',
          apiKey: config.apiSecret || channel.api_secret || '',
          baseUrl: channel.api_base_url,
        });

        const result = await sdk.getOrCreateCardholder({
          userId,
          email: sanitizedEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          countryCode: 'SG',
          phoneNumber: phone.trim(),
          database: null,
        });

        providerId = result.cardholder_id || result.id || '';
        if (!providerId) throw new Error('UQPay 未返回 cardholder_id');

        // 同步到 uqpay_cardholders 表（旧表兼容）
        db.prepare(`
          INSERT OR REPLACE INTO uqpay_cardholders (user_id, uqpay_cardholder_id, email, phone_number, cardholder_status)
          VALUES (?, ?, ?, ?, 'SUCCESS')
        `).run(userId, providerId, sanitizedEmail, phone.trim());
      }

      if (chCode === 'GEO') {
        const { GeoSdk } = await import('../channels/geo');
        const channel = db.prepare("SELECT * FROM card_channels WHERE UPPER(channel_code)='GEO' AND status=1").get() as any;
        if (!channel) throw new Error('GEO 渠道未启用');

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

        const result = await sdk.createCardholder({
          userReqNo: crypto.randomUUID(),
          cardUserId,
          mobile: phone.trim(),
          mobilePrefix: geoMp,
          email: sanitizedEmail,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthDate: birthDate.trim(),
          billingCity: geoBillingCity.trim(),
          billingState: geoBillingState.trim(),
          billingCountry: geoCc,
          billingAddress: geoBillingAddress.trim(),
          billingZipCode: geoBillingZipCode.trim(),
          countryCode: geoCc,
        });

        providerId = result.cardUserId || cardUserId;
        if (!providerId) throw new Error('GEO 未返回 cardUserId');

        // 写入 geoCardUserIds（旧表兼容）
        geoConfig.geoCardUserIds = geoConfig.geoCardUserIds || {};
        geoConfig.geoCardUserIds[String(userId)] = providerId;
        db.prepare("UPDATE card_channels SET config_json = ?, updated_at = datetime('now') WHERE channel_code = 'GEO'")
          .run(JSON.stringify(geoConfig));
      }

      // 构建该渠道的 provider_payload
      let providerPayload: any = {};
      if (chCode === 'UQPAY') {
        providerPayload = {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: sanitizedEmail,
          phone: phone.trim(),
          countryCode: 'SG',
          addressLine1: String(uqpayAddressLine1 || '').trim(),
          city: String(uqpayCity || '').trim(),
          state: String(uqpayState || '').trim(),
          postalCode: String(uqpayPostalCode || '').trim(),
        };
      }
      if (chCode === 'GEO') {
        providerPayload = {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: sanitizedEmail,
          mobile: phone.trim(),
          mobilePrefix: geoMp,
          birthDate: birthDate.trim(),
          countryCode: geoCc,
          billingCountry: geoCc,
          billingState: geoBillingState.trim(),
          billingCity: geoBillingCity.trim(),
          billingAddress: geoBillingAddress.trim(),
          billingZipCode: geoBillingZipCode.trim(),
        };
      }

      // 写入 cardholder_channel_accounts
      db.prepare(`
        INSERT OR REPLACE INTO cardholder_channel_accounts
          (profile_id, user_id, channel_code, provider_cardholder_id, provider_email, sync_status, provider_payload_json)
        VALUES (?, ?, ?, ?, ?, 'success', ?)
      `).run(profileId, userId, chCode, providerId, sanitizedEmail, JSON.stringify(providerPayload));

      saveDatabase();
      syncResults.push({
        channelCode: chCode,
        success: true,
        providerCardholderIdLast4: providerId.slice(-4),
      });
    } catch (err: any) {
      const msg = (err.message || '').slice(0, 300);
      console.error('[Cardholder] 同步 ' + chCode + ' 失败:', msg);

      db.prepare(`
        INSERT OR REPLACE INTO cardholder_channel_accounts
          (profile_id, user_id, channel_code, provider_cardholder_id, provider_email, sync_status, last_error)
        VALUES (?, ?, ?, '', ?, 'failed', ?)
      `).run(profileId, userId, chCode, sanitizedEmail, msg);

      saveDatabase();
      syncResults.push({
        channelCode: chCode,
        success: false,
        error: msg,
      });
    }
  }

  const allSuccess = syncResults.every(r => r.success);
  res.json({
    code: 0,
    message: allSuccess ? '持卡人创建完成' : '部分渠道创建失败，可重试同步',
    data: { profileId, syncResults },
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

  if (pending.length === 0) {
    return res.json({ code: 0, message: '所有渠道已同步完成', timestamp: Date.now() });
  }

  interface SyncResult { channelCode: string; success: boolean; providerCardholderIdLast4?: string; error?: string }
  const syncResults: SyncResult[] = [];

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
          billingCity: profile.billing_city || 'Los Angeles', billingState: profile.billing_state || 'CA',
          billingCountry: profile.billing_country || 'USA', billingAddress: profile.billing_address || 'Default',
          billingZipCode: profile.billing_zip_code || '90012', countryCode: profile.country_code || 'USA',
        });
        providerId = result.cardUserId || cardUserId;
      }

      if (providerId) {
        db.prepare(`
          INSERT OR REPLACE INTO cardholder_channel_accounts
            (profile_id, user_id, channel_code, provider_cardholder_id, provider_email, sync_status)
          VALUES (?, ?, ?, ?, ?, 'success')
        `).run(profileId, req.user!.userId, chCode, providerId, profile.email);
      }

      syncResults.push({
        channelCode: chCode,
        success: !!providerId,
        providerCardholderIdLast4: providerId ? providerId.slice(-4) : undefined,
      });
    } catch (err: any) {
      syncResults.push({ channelCode: chCode, success: false, error: (err.message || '').slice(0, 200) });
    }
  }

  saveDatabase();
  res.json({ code: 0, message: 'sync_results', data: syncResults, timestamp: Date.now() });
});

export default router;
