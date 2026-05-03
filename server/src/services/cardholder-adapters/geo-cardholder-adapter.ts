/**
 * GEO 持卡人适配器
 *
 * 实现 CardholderAdapter 接口，封装 GEO 持卡人的：
 * - 字段定义（schema）
 * - 校验规则
 * - 数据清洗
 * - 调用 GEO SDK createCardholder
 * - 写入 config_json.geoCardUserIds
 */

import crypto from 'crypto';
import { CardholderAdapter, CardholderFieldSchema, ValidationResult, NormalizedCardholderInput, CardholderCreateResult, FieldSchema } from './types';
import db, { saveDatabase } from '../../db';

// ── 允许的国家列表 ─────────────────────────────────────────────────────────────

const ALLOWED_COUNTRIES = ['USA', 'SG', 'HK'];
const MOBILE_PREFIX_MAP: Record<string, string> = { USA: '1', SG: '65', HK: '852' };

// ── 字段 schema ───────────────────────────────────────────────────────────────

const FIELDS: FieldSchema[] = [
  { name: 'firstName', label: '名 (First Name)', type: 'text', required: true, placeholder: 'John', example: 'John', pattern: /^[a-zA-Z\s\-']+$/, patternMessage: '只能包含字母、空格和短横线', minLength: 1, maxLength: 50 },
  { name: 'lastName', label: '姓 (Last Name)', type: 'text', required: true, placeholder: 'Doe', example: 'Doe', pattern: /^[a-zA-Z\s\-']+$/, patternMessage: '只能包含字母、空格和短横线', minLength: 1, maxLength: 50 },
  { name: 'email', label: '邮箱', type: 'email', required: true, placeholder: 'john@example.com', example: 'john@example.com', maxLength: 100 },
  { name: 'phone', label: '手机号', type: 'tel', required: true, placeholder: '1234567890', example: '1234567890', minLength: 6, maxLength: 20, description: '纯数字，不带 + 前缀' },
  { name: 'mobilePrefix', label: '手机区号', type: 'text', required: true, defaultValue: '1', placeholder: '1', example: '1', minLength: 1, maxLength: 5, description: '根据国家自动填写：USA=1, SG=65, HK=852' },
  { name: 'birthDate', label: '出生日期', type: 'text', required: true, placeholder: '1990-01-01', example: '1990-01-01', pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: '格式必须为 YYYY-MM-DD' },
  { name: 'countryCode', label: '国家', type: 'select', required: true, options: [{ value: 'USA', label: 'USA' }, { value: 'SG', label: 'SG' }, { value: 'HK', label: 'HK' }], defaultValue: 'USA', example: 'USA' },
  { name: 'billingCountry', label: '账单国家', type: 'select', required: true, options: [{ value: 'USA', label: 'USA' }, { value: 'SG', label: 'SG' }, { value: 'HK', label: 'HK' }], defaultValue: 'USA', example: 'USA' },
  { name: 'billingState', label: '账单州/省', type: 'text', required: true, placeholder: 'CA', example: 'CA', minLength: 1, maxLength: 50 },
  { name: 'billingCity', label: '账单城市', type: 'text', required: true, placeholder: 'Los Angeles', example: 'Los Angeles', minLength: 1, maxLength: 100 },
  { name: 'billingAddress', label: '账单地址', type: 'text', required: true, placeholder: '123 Main Street', example: '123 Main Street', minLength: 2, maxLength: 200 },
  { name: 'billingZipCode', label: '账单邮编', type: 'text', required: true, placeholder: '90001', example: '90001', minLength: 3, maxLength: 20 },
];

const CSV_HEADER = 'firstName,lastName,email,phone,mobilePrefix,birthDate,countryCode,billingCountry,billingState,billingCity,billingAddress,billingZipCode';
const CSV_EXAMPLE = 'John,Doe,john@example.com,1234567890,1,1990-01-01,USA,USA,CA,Los Angeles,123 Main Street,90001';

// ── 脱敏工具 ──────────────────────────────────────────────────────────────────

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

// ── 校验 ──────────────────────────────────────────────────────────────────────

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
  if (!cc) errs.push('countryCode 不能为空');
  else if (!ALLOWED_COUNTRIES.includes(cc)) errs.push(`countryCode 仅支持 ${ALLOWED_COUNTRIES.join('/')}`);
  return errs;
}

function validateBillingCountry(cc: string): string[] {
  const errs: string[] = [];
  if (!cc) errs.push('billingCountry 不能为空');
  else if (!ALLOWED_COUNTRIES.includes(cc)) errs.push(`billingCountry 仅支持 ${ALLOWED_COUNTRIES.join('/')}`);
  return errs;
}

function validateAddressField(val: string, field: string, minLen: number, maxLen: number): string[] {
  const errs: string[] = [];
  if (!val || !val.trim()) errs.push(`${field} 不能为空`);
  else if (val.trim().length < minLen) errs.push(`${field} 至少需要 ${minLen} 个字符`);
  else if (val.trim().length > maxLen) errs.push(`${field} 不能超过 ${maxLen} 个字符`);
  else if (/<[^>]*>|javascript:|on\w+=/i.test(val)) errs.push(`${field} 包含非法内容`);
  else if (/\n|\r/.test(val)) errs.push(`${field} 不能包含换行符`);
  else if (/^[^a-zA-Z0-9]+$/.test(val.trim())) errs.push(`${field} 不能仅为特殊符号`);
  return errs;
}

// ── Adapter 实现 ──────────────────────────────────────────────────────────────

export const geoCardholderAdapter: CardholderAdapter = {
  channelCode: 'GEO',

  getSchema(): CardholderFieldSchema {
    return {
      channelCode: 'GEO',
      fields: FIELDS,
      csvHeader: CSV_HEADER,
      csvExample: CSV_EXAMPLE,
    };
  },

  validate(input: Record<string, any>, rowIndex?: number): ValidationResult {
    const errors: string[] = [];
    const prefix = rowIndex != null ? `第 ${rowIndex} 行: ` : '';
    const firstName = (input.firstName || '').trim();
    const lastName = (input.lastName || '').trim();
    const email = (input.email || '').trim();
    const phone = (input.phone || '').trim();
    const mobilePrefix = (input.mobilePrefix || '').trim();
    const birthDate = (input.birthDate || '').trim();
    const countryCode = (input.countryCode || 'USA').trim().toUpperCase();
    const billingCountry = (input.billingCountry || countryCode).trim().toUpperCase();
    const billingState = (input.billingState || '').trim();
    const billingCity = (input.billingCity || '').trim();
    const billingAddress = (input.billingAddress || '').trim();
    const billingZipCode = (input.billingZipCode || '').trim();

    errors.push(...validateName(firstName, 'firstName').map(e => prefix + e));
    errors.push(...validateName(lastName, 'lastName').map(e => prefix + e));
    errors.push(...validateEmail(email).map(e => prefix + e));
    errors.push(...validatePhone(phone).map(e => prefix + e));
    errors.push(...validateCountryCode(countryCode).map(e => prefix + e));
    errors.push(...validateBillingCountry(billingCountry).map(e => prefix + e));
    errors.push(...validateAddressField(billingState, 'billingState', 1, 50).map(e => prefix + e));
    errors.push(...validateAddressField(billingCity, 'billingCity', 1, 100).map(e => prefix + e));
    errors.push(...validateAddressField(billingAddress, 'billingAddress', 2, 200).map(e => prefix + e));
    errors.push(...validateAddressField(billingZipCode, 'billingZipCode', 3, 20).map(e => prefix + e));

    if (!birthDate) errors.push(prefix + 'birthDate 不能为空');
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) errors.push(prefix + 'birthDate 格式必须为 YYYY-MM-DD');

    if (!mobilePrefix) errors.push(prefix + 'mobilePrefix 不能为空');

    return {
      valid: errors.length === 0,
      errors,
      data: { firstName, lastName, email, phone, mobilePrefix, birthDate, countryCode, billingCountry, billingState, billingCity, billingAddress, billingZipCode },
    };
  },

  normalize(input: Record<string, any>): NormalizedCardholderInput {
    const cc = (input.countryCode || 'USA').trim().toUpperCase();
    const bc = (input.billingCountry || cc).trim().toUpperCase();
    const mp = input.mobilePrefix || MOBILE_PREFIX_MAP[cc] || '1';
    return {
      firstName: (input.firstName || '').trim(),
      lastName: (input.lastName || '').trim(),
      email: (input.email || '').trim(),
      phone: (input.phone || '').trim().replace(/[^0-9]/g, ''),
      countryCode: cc,
      addressLine1: input.billingAddress || 'Default Address',
      city: input.billingCity || '',
      state: input.billingState || '',
      mobilePrefix: mp.replace(/^\+/, ''),
      birthDate: input.birthDate || '1990-01-01',
      billingCountry: bc,
      billingState: input.billingState || '',
      billingCity: input.billingCity || '',
      billingAddress: input.billingAddress || 'Default Address',
      billingZipCode: input.billingZipCode || '',
    };
  },

  async createCardholder(input: NormalizedCardholderInput): Promise<CardholderCreateResult> {
    const channel = db.prepare(
      "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'GEO' AND status = 1"
    ).get() as any;
    if (!channel) throw new Error('GEO 渠道未启用');
    if (!channel.api_base_url) throw new Error('GEO 渠道 api_base_url 未配置');

    let geoConfig: Record<string, any> = {};
    try { geoConfig = JSON.parse(channel.config_json || '{}'); } catch (_) {}

    const { GeoSdk, generateGeoCardUserId } = await import('../../channels/geo');
    const sdk = new GeoSdk({
      baseUrl: channel.api_base_url,
      userNo: geoConfig.userNo || '',
      privateKey: geoConfig.privateKey || '',
      geoPublicKey: geoConfig.geoPublicKey || '',
      customerPublicKey: geoConfig.customerPublicKey || '',
    });

    // 生成 cardUserId（GEOU{timestamp}{random4}，不绑定本地 userId）
    const cardUserId = 'GEOU' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase();

    const result = await sdk.createCardholder({
      userReqNo: crypto.randomUUID(),
      cardUserId,
      mobile: input.phone,
      mobilePrefix: input.mobilePrefix || '1',
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      birthDate: input.birthDate || '1990-01-01',
      billingCity: input.billingCity || 'Los Angeles',
      billingState: input.billingState || 'CA',
      billingCountry: input.billingCountry || 'USA',
      billingAddress: input.billingAddress || 'Default Address',
      billingZipCode: input.billingZipCode || '90012',
      countryCode: input.countryCode || 'USA',
    });

    const geoCardUserId = result.cardUserId || cardUserId;

    // 写入 config_json.geoCardUserIds（无 userId 时用 email 做 key 映射）
    const geoCardUserIds = geoConfig.geoCardUserIds || {};
    const emailKey = 'email:' + input.email.replace(/[^a-zA-Z0-9@.]/g, '_');
    geoCardUserIds[emailKey] = geoCardUserId;
    geoConfig.geoCardUserIds = geoCardUserIds;
    const newConfigJson = JSON.stringify(geoConfig);
    db.prepare("UPDATE card_channels SET config_json = ?, updated_at = datetime('now') WHERE channel_code = 'GEO'").run(newConfigJson);
    saveDatabase();

    console.log('[GEO] 持卡人创建成功: cardUserId=' + (geoCardUserId.slice(-4)));

    return {
      externalId: geoCardUserId,
      status: 'ACTIVE',
      kycStatus: 'PASSED',
      rawResponse: result,
    };
  },

  getCsvTemplate(): string {
    return CSV_HEADER + '\n' + CSV_EXAMPLE + '\n';
  },
};

export const geoMaskUtils = { maskEmail, maskPhone };
