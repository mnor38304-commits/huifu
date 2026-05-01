/**
 * DogPay 持卡人适配器
 *
 * 实现 CardholderAdapter 接口，封装 DogPay 持卡人的：
 * - 字段定义（schema）
 * - 校验规则
 * - 数据清洗
 * - 调用 DogPay SDK 创建持卡人
 */

import crypto from 'crypto';
import { CardholderAdapter, CardholderFieldSchema, ValidationResult, NormalizedCardholderInput, CardholderCreateResult, FieldSchema } from './types';
import db from '../../db';

// ── 字段 schema ───────────────────────────────────────────────────────────────

const FIELDS: FieldSchema[] = [
  { name: 'firstName', label: '名 (First Name)', type: 'text', required: true, placeholder: 'John', example: 'John', pattern: /^[a-zA-Z\s\-']+$/, patternMessage: '只能包含字母、空格和短横线', minLength: 1, maxLength: 50 },
  { name: 'lastName', label: '姓 (Last Name)', type: 'text', required: true, placeholder: 'Doe', example: 'Doe', pattern: /^[a-zA-Z\s\-']+$/, patternMessage: '只能包含字母、空格和短横线', minLength: 1, maxLength: 50 },
  { name: 'email', label: '邮箱', type: 'email', required: true, placeholder: 'john@example.com', example: 'john@example.com', maxLength: 100 },
  { name: 'phone', label: '手机号', type: 'tel', required: true, placeholder: '1234567890', example: '1234567890', minLength: 6, maxLength: 20, description: '纯数字，6-20 位，提交时自动去除 + 前缀' },
  { name: 'countryCode', label: '国家码', type: 'text', required: false, defaultValue: 'US', placeholder: 'US', example: 'US', minLength: 2, maxLength: 2, description: '2 位大写 ISO 国家码' },
  { name: 'addressLine1', label: '详细地址', type: 'text', required: true, placeholder: '123 Main Street', example: '123 Main Street', minLength: 2, maxLength: 200 },
  { name: 'city', label: '城市', type: 'text', required: true, placeholder: 'New York', example: 'New York', minLength: 1, maxLength: 100 },
  { name: 'state', label: '州/省', type: 'text', required: true, placeholder: 'NY', example: 'NY', minLength: 1, maxLength: 100 },
];

const CSV_HEADER = 'firstName,lastName,email,phone,countryCode,addressLine1,city,state';
const CSV_EXAMPLE = 'John,Doe,john@example.com,1234567890,US,123 Main Street,New York,NY';

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

export function maskIdNumber(id?: string): string {
  if (!id || id.length < 4) return id || '';
  return id.slice(0, 3) + '****' + id.slice(-2);
}

function hashIdNumber(id: string): string {
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
}

// ── 校验 ──────────────────────────────────────────────────────────────────────

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
  else if (!COUNTRY_CODES.includes(cc)) errs.push(`不支持的 countryCode: ${cc}`);
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

// ── 配置校验（导出发路由层复用） ─────────────────────────────────────────────

/**
 * 检查 DogPay 渠道配置是否完整。
 * 只从 config_json 读取 appId/appSecret，不允许 fallback 到 api_key/api_secret 列。
 * 配置不完整时抛出 Error。
 */
export function checkDogPayCreateCardholderConfig(): { channel: any; appId: string; appSecret: string } {
  const channel = db.prepare(
    "SELECT * FROM card_channels WHERE LOWER(channel_code) = 'dogpay' AND status = 1"
  ).get() as any;
  if (!channel) throw new Error('DogPay 渠道未启用（status≠1），请先在「渠道对接」页面启用');
  if (!channel.api_base_url) throw new Error('DogPay 渠道 api_base_url 未配置');

  let config: Record<string, string> = {};
  try { config = JSON.parse(channel.config_json || '{}'); } catch (_) {}

  if (!config.appId) throw new Error('DogPay 渠道 appId 未配置，请在 config_json 中设置');
  if (!config.appSecret) throw new Error('DogPay 渠道 appSecret 未配置，请在 config_json 中设置');

  return { channel, appId: config.appId, appSecret: config.appSecret };
}

// ── Adapter 实现 ──────────────────────────────────────────────────────────────

export const dogpayCardholderAdapter: CardholderAdapter = {
  channelCode: 'DOGPAY',

  getSchema(): CardholderFieldSchema {
    return {
      channelCode: 'DOGPAY',
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
    const countryCode = (input.countryCode || 'US').trim().toUpperCase();
    const addressLine1 = (input.addressLine1 || '').trim();
    const city = (input.city || '').trim();
    const state = (input.state || '').trim();

    // 如果旧字段 idType/idNumber 被传入且新地址字段为空，给出提示
    if (!addressLine1 && (input.idType != null || input.idNumber)) {
      errors.push(prefix + '模板字段已更新，请下载最新 CSV 模板（idType/idNumber 已替换为 addressLine1/city/state）');
    }

    errors.push(...validateName(firstName, 'firstName').map(e => prefix + e));
    errors.push(...validateName(lastName, 'lastName').map(e => prefix + e));
    errors.push(...validateEmail(email).map(e => prefix + e));
    errors.push(...validatePhone(phone).map(e => prefix + e));
    errors.push(...validateCountryCode(countryCode).map(e => prefix + e));
    errors.push(...validateAddressField(addressLine1, 'addressLine1', 2, 200).map(e => prefix + e));
    errors.push(...validateAddressField(city, 'city', 1, 100).map(e => prefix + e));
    errors.push(...validateAddressField(state, 'state', 1, 100).map(e => prefix + e));

    return {
      valid: errors.length === 0,
      errors,
      data: { firstName, lastName, email, phone, countryCode, addressLine1, city, state },
    };
  },

  normalize(input: Record<string, any>): NormalizedCardholderInput {
    return {
      firstName: (input.firstName || '').trim(),
      lastName: (input.lastName || '').trim(),
      email: (input.email || '').trim(),
      phone: (input.phone || '').trim().replace(/[^0-9]/g, ''),
      countryCode: (input.countryCode || 'US').trim().toUpperCase(),
      addressLine1: (input.addressLine1 || '').trim(),
      city: (input.city || '').trim(),
      state: (input.state || '').trim(),
    };
  },

  async createCardholder(input: NormalizedCardholderInput): Promise<CardholderCreateResult> {
    // 使用统一配置校验（只从 config_json 读取，不允许 fallback）
    const { channel, appId, appSecret } = checkDogPayCreateCardholderConfig();

    const { DogPaySDK } = await import('../../channels/dogpay');
    const sdk = new DogPaySDK({ appId, appSecret, apiBaseUrl: channel.api_base_url });
    const result = await sdk.createCardholder({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      countryCode: input.countryCode,
      addressLine1: input.addressLine1,
      city: input.city,
      state: input.state,
    });

    return {
      externalId: result.id || '',
      status: result.status || 'PENDING',
      kycStatus: result.kycStatus || 'PENDING',
      rawResponse: result,
    };
  },

  getCsvTemplate(): string {
    return CSV_HEADER + '\n' + CSV_EXAMPLE + '\n';
  },
};

// ── 导出脱敏工具（供路由层使用） ──────────────────────────────────────────────

export const dogpayMaskUtils = { maskEmail, maskPhone, maskIdNumber, hashIdNumber };
