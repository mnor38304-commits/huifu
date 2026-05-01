/**
 * Admin 端 — 持卡人管理
 *
 * 路由前缀: /api/admin/cardholders（在 index.ts 中挂载）
 *
 * 功能:
 *  - 持卡人列表（脱敏展示）
 *  - 单个添加持卡人（调用 DogPay SDK）
 *  - 批量预校验（不调用 DogPay，不写 DB）
 *  - 批量添加持卡人（逐条调用 DogPay）
 *  - 查看详情
 *  - 下载 CSV 模板
 */

import { Router, Response } from 'express';
import crypto from 'crypto';
import db, { saveDatabase } from '../db';
import { adminAuth, AdminRequest, requireAdminRole, writeAdminLog } from './admin-auth';

const router = Router();

// 所有路由需要管理员认证
router.use(adminAuth);

// ── 工具: 获取 DogPay SDK（含配置完整性校验）───────────────────────────────

async function getDogPaySDK() {
  const channel = db.prepare(
    "SELECT * FROM card_channels WHERE LOWER(channel_code) = 'dogpay'"
  ).get() as any;
  if (!channel) {
    throw new Error('DogPay 渠道未配置，请先在「渠道对接」页面添加 DogPay 渠道');
  }
  if (Number(channel.status) !== 1) {
    throw new Error('DogPay 渠道未启用（status≠1），请先在「渠道对接」页面启用');
  }
  if (!channel.api_base_url) {
    throw new Error('DogPay 渠道 api_base_url 未配置');
  }
  let config: Record<string, string> = {};
  try { config = JSON.parse(channel.config_json || '{}'); } catch (_) {}
  const appId = config.appId || channel.api_key || '';
  const appSecret = config.appSecret || channel.api_secret || '';
  if (!appId) {
    throw new Error('DogPay 渠道 appId 未配置，请在 config_json 中设置');
  }
  if (!appSecret) {
    throw new Error('DogPay 渠道 appSecret 未配置，请在 config_json 中设置');
  }
  const { DogPaySDK } = await import('../channels/dogpay');
  return new DogPaySDK({ appId, appSecret, apiBaseUrl: channel.api_base_url });
}

// ── 工具: 脱敏 ────────────────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return email;
  return email[0] + '***' + email.substring(at);
}

function maskPhone(phone: string): string {
  const s = phone.replace(/\D/g, '');
  if (s.length <= 4) return '****' + s;
  return '****' + s.slice(-4);
}

function maskIdNumber(id?: string): string {
  if (!id || id.length < 4) return id || '';
  return id.slice(0, 3) + '****' + id.slice(-2);
}

function hashIdNumber(id: string): string {
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
}

// ── 工具: 字段校验 ────────────────────────────────────────────────────────────

const COUNTRY_CODES = ['US', 'SG', 'CN', 'GB', 'HK', 'JP', 'KR', 'TH', 'VN', 'MY', 'ID', 'PH', 'AU', 'CA', 'DE', 'FR'];

function validateName(name: string, field: string): string[] {
  const errs: string[] = [];
  if (!name || !name.trim()) errs.push(`${field} 不能为空`);
  else if (name.trim().length < 1 || name.trim().length > 50) errs.push(`${field} 长度需在 1-50 之间`);
  else if (!/^[a-zA-Z\s\-']+$/.test(name.trim())) errs.push(`${field} 只能包含字母、空格和短横线`);
  return errs;
}

function validateEmail(email: string): string[] {
  const errs: string[] = [];
  if (!email || !email.trim()) errs.push('email 不能为空');
  else if (email.length > 100) errs.push('email 长度不能超过 100');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.push('email 格式不正确');
  return errs;
}

function validatePhone(phone: string): string[] {
  const errs: string[] = [];
  if (!phone || !phone.trim()) errs.push('phone 不能为空');
  else {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 20) errs.push('phone 无效，纯数字需 6-20 位');
    if (/^0{3,}$/.test(digits)) errs.push('phone 不能为纯零的测试值');
  }
  return errs;
}

function validateCountryCode(cc: string): string[] {
  const errs: string[] = [];
  if (!cc) return errs;
  if (cc.length !== 2) errs.push('countryCode 必须为 2 位大写字母');
  else if (!COUNTRY_CODES.includes(cc.toUpperCase())) errs.push(`不支持的 countryCode: ${cc}`);
  return errs;
}

function validateIdType(t: any): string[] {
  const errs: string[] = [];
  if (t == null) return errs;
  const n = Number(t);
  if (![0, 1, 2].includes(n)) errs.push('idType 只能为 0(身份证) / 1(护照) / 2(驾照)');
  return errs;
}

function validateIdNumber(id?: string): string[] {
  const errs: string[] = [];
  if (!id || !id.trim()) return errs;
  if (id.length < 4 || id.length > 64) errs.push('idNumber 长度需在 4-64 之间');
  return errs;
}

function validateRow(data: any, rowIndex?: number): { valid: boolean; errors: string[]; cleaned: any } {
  const errors: string[] = [];
  const prefix = rowIndex != null ? `第 ${rowIndex} 行: ` : '';

  const firstName = (data.firstName || '').trim();
  const lastName = (data.lastName || '').trim();
  const email = (data.email || '').trim();
  const phone = (data.phone || '').trim();
  const countryCode = (data.countryCode || 'US').toUpperCase().trim();
  const idType = data.idType != null && data.idType !== '' ? Number(data.idType) : 0;
  const idNumber = (data.idNumber || '').trim();

  errors.push(...validateName(firstName, 'firstName').map(e => prefix + e));
  errors.push(...validateName(lastName, 'lastName').map(e => prefix + e));
  errors.push(...validateEmail(email).map(e => prefix + e));
  errors.push(...validatePhone(phone).map(e => prefix + e));
  errors.push(...validateCountryCode(countryCode).map(e => prefix + e));
  errors.push(...validateIdType(idType).map(e => prefix + e));
  errors.push(...validateIdNumber(idNumber).map(e => prefix + e));

  return {
    valid: errors.length === 0,
    errors,
    cleaned: { firstName, lastName, email, phone, countryCode, idType, idNumber },
  };
}

// ── 1. 持卡人列表 ──────────────────────────────────────────────────────────

router.get('/', requireAdminRole('admin', 'super'), (req: AdminRequest, res) => {
  const { page = 1, pageSize = 20, channel = 'DOGPAY', status, kycStatus, keyword } = req.query;
  let sql = 'SELECT * FROM cardholders WHERE channel_code = ?';
  const params: any[] = [channel || 'DOGPAY'];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (kycStatus) { sql += ' AND kyc_status = ?'; params.push(kycStatus); }
  if (keyword) {
    sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR external_id LIKE ?)';
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw, kw);
  }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM (${sql})`).get(...params) as any)?.c || 0;
  const offset = (Number(page) - 1) * Number(pageSize);
  const list = db.prepare(sql + ' ORDER BY id DESC LIMIT ? OFFSET ?').all(...params, Number(pageSize), offset);

  const masked = list.map((r: any) => ({
    ...r,
    email_masked: maskEmail(r.email || ''),
    phone_masked: maskPhone(r.phone || ''),
    id_number_masked: r.id_number_masked || maskIdNumber(r.id_number_hash || ''),
    // 移除原始敏感字段
    raw_response_json: undefined,
  }));

  res.json({ code: 0, data: { list: masked, total, page: Number(page), pageSize: Number(pageSize) }, timestamp: Date.now() });
});

// ── 2. 持卡人详情 ──────────────────────────────────────────────────────────

router.get('/:id', requireAdminRole('admin', 'super'), (req: AdminRequest, res) => {
  const cardholder = db.prepare('SELECT * FROM cardholders WHERE id = ?').get(req.params.id) as any;
  if (!cardholder) return res.json({ code: 404, message: '持卡人不存在', timestamp: Date.now() });

  res.json({
    code: 0,
    data: {
      ...cardholder,
      email_masked: maskEmail(cardholder.email || ''),
      phone_masked: maskPhone(cardholder.phone || ''),
      id_number_masked: cardholder.id_number_masked || maskIdNumber(cardholder.id_number_hash || ''),
      raw_response_json: cardholder.raw_response_json ? JSON.parse(cardholder.raw_response_json) : null,
    },
    timestamp: Date.now(),
  });
});

// ── 3. 单个创建持卡人 ──────────────────────────────────────────────────────

router.post('/', requireAdminRole('admin', 'super'), async (req: AdminRequest, res) => {
  const { channelCode = 'DOGPAY', firstName, lastName, email, phone, countryCode, idType, idNumber } = req.body;

  const validation = validateRow({ firstName, lastName, email, phone, countryCode, idType, idNumber });
  if (!validation.valid) {
    return res.json({ code: 400, message: validation.errors.join('; '), timestamp: Date.now() });
  }

  const { cleaned } = validation;

  // 检查重复
  const existing = db.prepare(
    "SELECT id FROM cardholders WHERE channel_code = ? AND email = ? AND phone = ?"
  ).get(channelCode, cleaned.email, cleaned.phone) as any;
  if (existing) {
    return res.json({ code: 400, message: `该持卡人已存在 (id=${existing.id})`, timestamp: Date.now() });
  }

  let sdk: any;
  try {
    sdk = await getDogPaySDK();
  } catch (err: any) {
    const msg = (err.message || '').slice(0, 300);
    return res.json({ code: 503, message: msg, timestamp: Date.now() });
  }

  try {
    const result = await sdk.createCardholder({
      firstName: cleaned.firstName,
      lastName: cleaned.lastName,
      email: cleaned.email,
      phone: cleaned.phone.replace(/[^0-9]/g, ''),
      countryCode: cleaned.countryCode,
      idType: cleaned.idType,
      idNumber: cleaned.idNumber,
    });

    const externalId = result.id || '';
    const status = result.status || 'PENDING';
    const kycStatus = result.kycStatus || 'PENDING';
    const rawJson = JSON.stringify(result);

    const dbResult = db.prepare(`
      INSERT INTO cardholders (channel_code, external_id, first_name, last_name, email, phone,
        country_code, id_type, id_number_masked, id_number_hash, status, kyc_status,
        raw_response_json, created_by_admin_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      channelCode, externalId, cleaned.firstName, cleaned.lastName, cleaned.email, cleaned.phone,
      cleaned.countryCode, cleaned.idType,
      maskIdNumber(cleaned.idNumber), cleaned.idNumber ? hashIdNumber(cleaned.idNumber) : null,
      status, kycStatus, rawJson, req.admin?.id || 0,
    );

    writeAdminLog({
      adminId: req.admin?.id || 0,
      adminName: req.admin?.username || '',
      action: 'CREATE_CARDHOLDER',
      targetType: 'cardholder',
      targetId: dbResult.lastInsertRowid as number,
      detail: `channel=${channelCode} externalId=${externalId.substring(0, 12)}... status=${status}`,
      req,
    });

    res.json({
      code: 0,
      data: { local_id: dbResult.lastInsertRowid, external_id: externalId, status, kyc_status: kycStatus },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    const msg = (err.message || '').slice(0, 200);

    // 保存失败记录
    db.prepare(`
      INSERT INTO cardholders (channel_code, first_name, last_name, email, phone,
        country_code, id_type, id_number_masked, id_number_hash, status, error_message, created_by_admin_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'FAILED', ?, ?)
    `).run(
      channelCode, cleaned.firstName, cleaned.lastName, cleaned.email, cleaned.phone,
      cleaned.countryCode, cleaned.idType,
      maskIdNumber(cleaned.idNumber), cleaned.idNumber ? hashIdNumber(cleaned.idNumber) : null,
      msg, req.admin?.id || 0,
    );

    writeAdminLog({
      adminId: req.admin?.id || 0,
      adminName: req.admin?.username || '',
      action: 'CREATE_CARDHOLDER_FAILED',
      targetType: 'cardholder',
      detail: `channel=${channelCode} error=${msg}`,
      req,
    });

    res.json({ code: 503, message: 'DogPay 创建失败: ' + msg, timestamp: Date.now() });
  }
});

// ── 4. 批量预校验 ──────────────────────────────────────────────────────────

router.post('/batch/validate', requireAdminRole('admin', 'super'), (req: AdminRequest, res) => {
  const { rows, channelCode = 'DOGPAY' } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ code: 400, message: '请提供待校验数据', timestamp: Date.now() });
  }
  if (rows.length > 100) {
    return res.json({ code: 400, message: '单次最多校验 100 条', timestamp: Date.now() });
  }

  const results = rows.map((row: any, idx: number) => {
    const v = validateRow(row, idx + 1);
    return {
      row: idx + 1,
      valid: v.valid,
      errors: v.errors,
      data: v.valid ? {
        ...v.cleaned,
        email_masked: maskEmail(v.cleaned.email),
        phone_masked: maskPhone(v.cleaned.phone),
        idNumberMasked: v.cleaned.idNumber ? maskIdNumber(v.cleaned.idNumber) : '',
      } : null,
    };
  });

  const valid = results.filter(r => r.valid).length;
  const invalid = results.length - valid;

  res.json({
    code: 0,
    data: { total: rows.length, valid, invalid, rows: results },
    timestamp: Date.now(),
  });
});

// ── 5. 批量创建 ──────────────────────────────────────────────────────────

router.post('/batch/create', requireAdminRole('admin', 'super'), async (req: AdminRequest, res) => {
  const { rows, channelCode = 'DOGPAY' } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ code: 400, message: '请提供待创建数据', timestamp: Date.now() });
  }
  if (rows.length > 100) {
    return res.json({ code: 400, message: '单次最多创建 100 条', timestamp: Date.now() });
  }

  let sdk: any;
  try {
    sdk = await getDogPaySDK();
  } catch (err: any) {
    const msg = (err.message || '').slice(0, 300);
    return res.json({ code: 503, message: msg, timestamp: Date.now() });
  }

  const results: any[] = [];
  let success = 0;
  let failed = 0;

  // 串行逐条创建，避免触发限流
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const v = validateRow(row, i + 1);

    if (!v.valid) {
      failed++;
      results.push({ row: i + 1, success: false, error: v.errors.join('; ') });
      continue;
    }

    try {
      const dogpayResult = await (sdk as any).createCardholder({
        firstName: v.cleaned.firstName,
        lastName: v.cleaned.lastName,
        email: v.cleaned.email,
        phone: v.cleaned.phone.replace(/[^0-9]/g, ''),
        countryCode: v.cleaned.countryCode,
        idType: v.cleaned.idType,
        idNumber: v.cleaned.idNumber,
      });

      const externalId = dogpayResult.id || '';
      const status = dogpayResult.status || 'PENDING';
      const kycStatus = dogpayResult.kycStatus || 'PENDING';

      const dbResult = db.prepare(`
        INSERT INTO cardholders (channel_code, external_id, first_name, last_name, email, phone,
          country_code, id_type, id_number_masked, id_number_hash, status, kyc_status,
          raw_response_json, created_by_admin_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        channelCode, externalId, v.cleaned.firstName, v.cleaned.lastName, v.cleaned.email, v.cleaned.phone,
        v.cleaned.countryCode, v.cleaned.idType,
        maskIdNumber(v.cleaned.idNumber), v.cleaned.idNumber ? hashIdNumber(v.cleaned.idNumber) : null,
        status, kycStatus, JSON.stringify(dogpayResult), req.admin?.id || 0,
      );

      success++;
      results.push({
        row: i + 1, success: true,
        local_id: dbResult.lastInsertRowid,
        external_id: externalId,
        status,
        kyc_status: kycStatus,
      });
    } catch (err: any) {
      failed++;
      const msg = (err.message || '').slice(0, 200);
      results.push({ row: i + 1, success: false, error: msg });

      // 记录失败
      db.prepare(`
        INSERT INTO cardholders (channel_code, first_name, last_name, email, phone,
          country_code, id_type, id_number_masked, id_number_hash, status, error_message, created_by_admin_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'FAILED', ?, ?)
      `).run(
        channelCode, v.cleaned.firstName, v.cleaned.lastName, v.cleaned.email, v.cleaned.phone,
        v.cleaned.countryCode, v.cleaned.idType,
        maskIdNumber(v.cleaned.idNumber), v.cleaned.idNumber ? hashIdNumber(v.cleaned.idNumber) : null,
        msg, req.admin?.id || 0,
      );
    }
  }

  writeAdminLog({
    adminId: req.admin?.id || 0,
    adminName: req.admin?.username || '',
    action: 'BATCH_CREATE_CARDHOLDER',
    targetType: 'cardholder',
    detail: `channel=${channelCode} total=${rows.length} success=${success} failed=${failed}`,
    req,
  });

  res.json({
    code: 0,
    data: { total: rows.length, success, failed, results },
    timestamp: Date.now(),
  });
});

// ── 6. 下载 CSV 模板 ──────────────────────────────────────────────────────

router.get('/template/download', requireAdminRole('admin', 'super'), (req: AdminRequest, res) => {
  const header = 'firstName,lastName,email,phone,countryCode,idType,idNumber\n';
  const sample = 'John,Doe,john@example.com,1234567890,US,1,P123456789\n';
  const csv = '\uFEFF' + header + sample; // BOM for Excel
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="cardholder-template.csv"');
  res.send(csv);
});

export default router;
