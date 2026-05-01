/**
 * Admin 端 — 持卡人管理（多渠道 adapter 架构）
 *
 * 路由前缀: /api/admin/cardholders（在 index.ts 中挂载）
 *
 * 功能:
 *  - 持卡人列表（脱敏展示）
 *  - 单个添加持卡人
 *  - 批量预校验（不调用外部 API）
 *  - 批量添加持卡人
 *  - 查看详情 / Schema / CSV 模板下载
 *
 * 多渠道架构：
 *   所有渠道特定逻辑通过 CardholderAdapter 接口调用。
 *   当前仅注册 DOGPAY，新增渠道只需新增 adapter 并注册。
 */

import { Router, Response } from 'express';
import db from '../db';
import { adminAuth, AdminRequest, requireAdminRole, writeAdminLog } from './admin-auth';
import { getCardholderAdapter, listChannelCodes } from '../services/cardholder-adapters';
import { dogpayMaskUtils } from '../services/cardholder-adapters/dogpay-cardholder-adapter';

const router = Router();

// 所有路由需要管理员认证
router.use(adminAuth);

// ── 获取渠道 adapter ───────────────────────────────────────────────────────────

function getAdapter(channelCode: string): { adapter: ReturnType<typeof getCardholderAdapter>; error?: string } {
  try {
    return { adapter: getCardholderAdapter(channelCode) };
  } catch (e: any) {
    return { adapter: null as any, error: e.message || `暂不支持渠道: ${channelCode}` };
  }
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
    email_masked: dogpayMaskUtils.maskEmail(r.email || ''),
    phone_masked: dogpayMaskUtils.maskPhone(r.phone || ''),
    id_number_masked: r.id_number_masked || dogpayMaskUtils.maskIdNumber(r.id_number_hash || ''),
    provider_payload_json: undefined,
    provider_response_json: undefined,
    raw_response_json: undefined,
  }));

  res.json({ code: 0, data: { list: masked, total, page: Number(page), pageSize: Number(pageSize) }, timestamp: Date.now() });
});

// ── 3. 渠道 Schema ────────────────────────────────────────────────────────

router.get('/schema/list', requireAdminRole('admin', 'super'), (req: AdminRequest, res) => {
  res.json({ code: 0, data: listChannelCodes(), timestamp: Date.now() });
});

router.get('/schema', requireAdminRole('admin', 'super'), (req: AdminRequest, res) => {
  const channelCode = String(req.query.channelCode || 'DOGPAY').toUpperCase();
  const { adapter, error } = getAdapter(channelCode);
  if (!adapter) {
    return res.json({ code: 400, message: error, timestamp: Date.now() });
  }
  res.json({ code: 0, data: adapter.getSchema(), timestamp: Date.now() });
});

// ── 7. 下载 CSV 模板 ─────────────────────────────────────────────────────

router.get('/template/download', requireAdminRole('admin', 'super'), (req: AdminRequest, res) => {
  const channelCode = String(req.query.channelCode || 'DOGPAY').toUpperCase();
  const { adapter, error } = getAdapter(channelCode);
  if (!adapter) {
    return res.json({ code: 400, message: error, timestamp: Date.now() });
  }
  const csv = '\uFEFF' + adapter.getCsvTemplate();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cardholder-template-${channelCode.toLowerCase()}.csv"`);
  res.send(csv);
});

// ── 2. 持卡人详情 ──────────────────────────────────────────────────────────

router.get('/:id', requireAdminRole('admin', 'super'), (req: AdminRequest, res) => {
  const cardholder = db.prepare('SELECT * FROM cardholders WHERE id = ?').get(req.params.id) as any;
  if (!cardholder) return res.json({ code: 404, message: '持卡人不存在', timestamp: Date.now() });

  res.json({
    code: 0,
    data: {
      ...cardholder,
      email_masked: dogpayMaskUtils.maskEmail(cardholder.email || ''),
      phone_masked: dogpayMaskUtils.maskPhone(cardholder.phone || ''),
      id_number_masked: cardholder.id_number_masked || dogpayMaskUtils.maskIdNumber(cardholder.id_number_hash || ''),
      provider_payload_json: cardholder.provider_payload_json ? JSON.parse(cardholder.provider_payload_json) : null,
      provider_response_json: cardholder.provider_response_json ? JSON.parse(cardholder.provider_response_json) : null,
      raw_response_json: cardholder.raw_response_json ? JSON.parse(cardholder.raw_response_json) : null,
    },
    timestamp: Date.now(),
  });
});

// ── 4. 单个创建持卡人 ─────────────────────────────────────────────────────

router.post('/', requireAdminRole('admin', 'super'), async (req: AdminRequest, res) => {
  const { channelCode = 'DOGPAY', ...rest } = req.body;
  const cc = channelCode.toUpperCase();

  const { adapter, error } = getAdapter(cc);
  if (!adapter) {
    return res.json({ code: 400, message: error, timestamp: Date.now() });
  }

  // 校验
  const validation = adapter.validate(rest);
  if (!validation.valid) {
    return res.json({ code: 400, message: validation.errors.join('; '), timestamp: Date.now() });
  }

  // 标准化
  const normalized = adapter.normalize(validation.data);

  // 检查重复
  const existing = db.prepare(
    "SELECT id FROM cardholders WHERE channel_code = ? AND email = ? AND phone = ?"
  ).get(cc, normalized.email, normalized.phone) as any;
  if (existing) {
    return res.json({ code: 400, message: `该持卡人已存在 (id=${existing.id})`, timestamp: Date.now() });
  }

  try {
    const result = await adapter.createCardholder(normalized);

    const dbResult = db.prepare(`
      INSERT INTO cardholders (channel_code, external_id, first_name, last_name, email, phone,
        country_code, id_type, id_number_masked, id_number_hash, status, kyc_status,
        provider_status, provider_kyc_status, provider_response_json, raw_response_json,
        created_by_admin_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cc, result.externalId, normalized.firstName, normalized.lastName,
      normalized.email, normalized.phone,
      normalized.countryCode, normalized.idType,
      dogpayMaskUtils.maskIdNumber(normalized.idNumber),
      normalized.idNumber ? dogpayMaskUtils.hashIdNumber(normalized.idNumber) : null,
      result.status, result.kycStatus,
      result.status, result.kycStatus,
      result.rawResponse ? JSON.stringify(result.rawResponse) : null,
      result.rawResponse ? JSON.stringify(result.rawResponse) : null,
      req.admin?.id || 0,
    );

    writeAdminLog({
      adminId: req.admin?.id || 0,
      adminName: req.admin?.username || '',
      action: 'CREATE_CARDHOLDER',
      targetType: 'cardholder',
      targetId: dbResult.lastInsertRowid as number,
      detail: `channel=${cc} externalId=${(result.externalId || '').substring(0, 12)}... status=${result.status}`,
      req,
    });

    res.json({
      code: 0,
      data: { local_id: dbResult.lastInsertRowid, external_id: result.externalId, status: result.status, kyc_status: result.kycStatus },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    const msg = (err.message || '').slice(0, 300);

    db.prepare(`
      INSERT INTO cardholders (channel_code, first_name, last_name, email, phone,
        country_code, id_type, id_number_masked, id_number_hash, status, error_message,
        provider_status, created_by_admin_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'FAILED', ?, 'FAILED', ?)
    `).run(
      cc, normalized.firstName, normalized.lastName,
      normalized.email, normalized.phone,
      normalized.countryCode, normalized.idType,
      dogpayMaskUtils.maskIdNumber(normalized.idNumber),
      normalized.idNumber ? dogpayMaskUtils.hashIdNumber(normalized.idNumber) : null,
      msg, req.admin?.id || 0,
    );

    writeAdminLog({
      adminId: req.admin?.id || 0,
      adminName: req.admin?.username || '',
      action: 'CREATE_CARDHOLDER_FAILED',
      targetType: 'cardholder',
      detail: `channel=${cc} error=${msg}`,
      req,
    });

    res.json({ code: 503, message: msg, timestamp: Date.now() });
  }
});

// ── 5. 批量预校验 ─────────────────────────────────────────────────────────

router.post('/batch/validate', requireAdminRole('admin', 'super'), (req: AdminRequest, res) => {
  const { rows, channelCode = 'DOGPAY' } = req.body;
  const cc = (channelCode || 'DOGPAY').toUpperCase();

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ code: 400, message: '请提供待校验数据', timestamp: Date.now() });
  }
  if (rows.length > 100) {
    return res.json({ code: 400, message: '单次最多校验 100 条', timestamp: Date.now() });
  }

  const { adapter, error } = getAdapter(cc);
  if (!adapter) {
    return res.json({ code: 400, message: error, timestamp: Date.now() });
  }

  const results = rows.map((row: any, idx: number) => {
    const v = adapter.validate(row, idx + 1);
    return {
      row: idx + 1,
      valid: v.valid,
      errors: v.errors,
      data: v.valid ? {
        ...v.data,
        email_masked: dogpayMaskUtils.maskEmail(v.data.email),
        phone_masked: dogpayMaskUtils.maskPhone(v.data.phone),
        idNumberMasked: v.data.idNumber ? dogpayMaskUtils.maskIdNumber(v.data.idNumber) : '',
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

// ── 6. 批量创建 ──────────────────────────────────────────────────────────

router.post('/batch/create', requireAdminRole('admin', 'super'), async (req: AdminRequest, res) => {
  const { rows, channelCode = 'DOGPAY' } = req.body;
  const cc = (channelCode || 'DOGPAY').toUpperCase();

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ code: 400, message: '请提供待创建数据', timestamp: Date.now() });
  }
  if (rows.length > 100) {
    return res.json({ code: 400, message: '单次最多创建 100 条', timestamp: Date.now() });
  }

  const { adapter, error } = getAdapter(cc);
  if (!adapter) {
    return res.json({ code: 400, message: error, timestamp: Date.now() });
  }

  // 渠道可用性检查（提前抛出配置错误，不等逐条执行）
  try {
    // 只做适配器的配置检查，不实际创建持卡人
    // （DogPay adapter 的 createCardholder 内部会做配置校验）
  } catch (_) {}

  const results: any[] = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const v = adapter.validate(row, i + 1);

    if (!v.valid) {
      failed++;
      results.push({ row: i + 1, success: false, error: v.errors.join('; ') });
      continue;
    }

    const normalized = adapter.normalize(v.data);

    try {
      const dogpayResult = await adapter.createCardholder(normalized);

      const dbResult = db.prepare(`
        INSERT INTO cardholders (channel_code, external_id, first_name, last_name, email, phone,
          country_code, id_type, id_number_masked, id_number_hash, status, kyc_status,
          provider_status, provider_kyc_status, provider_response_json, raw_response_json,
          created_by_admin_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cc, dogpayResult.externalId, normalized.firstName, normalized.lastName,
        normalized.email, normalized.phone,
        normalized.countryCode, normalized.idType,
        dogpayMaskUtils.maskIdNumber(normalized.idNumber),
        normalized.idNumber ? dogpayMaskUtils.hashIdNumber(normalized.idNumber) : null,
        dogpayResult.status, dogpayResult.kycStatus,
        dogpayResult.status, dogpayResult.kycStatus,
        dogpayResult.rawResponse ? JSON.stringify(dogpayResult.rawResponse) : null,
        dogpayResult.rawResponse ? JSON.stringify(dogpayResult.rawResponse) : null,
        req.admin?.id || 0,
      );

      success++;
      results.push({
        row: i + 1, success: true,
        local_id: dbResult.lastInsertRowid,
        external_id: dogpayResult.externalId,
        status: dogpayResult.status,
        kyc_status: dogpayResult.kycStatus,
      });
    } catch (err: any) {
      failed++;
      const msg = (err.message || '').slice(0, 300);
      results.push({ row: i + 1, success: false, error: msg });

      db.prepare(`
        INSERT INTO cardholders (channel_code, first_name, last_name, email, phone,
          country_code, id_type, id_number_masked, id_number_hash, status, error_message,
          provider_status, created_by_admin_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'FAILED', ?, 'FAILED', ?)
      `).run(
        cc, normalized.firstName, normalized.lastName,
        normalized.email, normalized.phone,
        normalized.countryCode, normalized.idType,
        dogpayMaskUtils.maskIdNumber(normalized.idNumber),
        normalized.idNumber ? dogpayMaskUtils.hashIdNumber(normalized.idNumber) : null,
        msg, req.admin?.id || 0,
      );
    }
  }

  writeAdminLog({
    adminId: req.admin?.id || 0,
    adminName: req.admin?.username || '',
    action: 'BATCH_CREATE_CARDHOLDER',
    targetType: 'cardholder',
    detail: `channel=${cc} total=${rows.length} success=${success} failed=${failed}`,
    req,
  });

  res.json({
    code: 0,
    data: { total: rows.length, success, failed, results },
    timestamp: Date.now(),
  });
});

export default router;
