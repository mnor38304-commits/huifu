/**
 * UQPay 持卡人适配器
 *
 * 实现 CardholderAdapter 接口，封装 UQPay 持卡人的：
 * - 字段定义（schema）
 * - 校验规则
 * - 数据清洗
 * - 调用 UQPay SDK 创建持卡人（通过 getOrCreateCardholder）
 */

import crypto from 'crypto';
import { CardholderAdapter, CardholderFieldSchema, ValidationResult, NormalizedCardholderInput, CardholderCreateResult, FieldSchema } from './types';
import db from '../../db';

// ── 字段 schema ───────────────────────────────────────────────────────────────

const FIELDS: FieldSchema[] = [
  { name: 'firstName', label: '名 (First Name)', type: 'text', required: true, placeholder: 'John', example: 'John', pattern: /^[a-zA-Z\s\-']+$/, patternMessage: '只能包含字母、空格和短横线', minLength: 1, maxLength: 50 },
  { name: 'lastName', label: '姓 (Last Name)', type: 'text', required: true, placeholder: 'Doe', example: 'Doe', pattern: /^[a-zA-Z\s\-']+$/, patternMessage: '只能包含字母、空格和短横线', minLength: 1, maxLength: 50 },
  { name: 'email', label: '邮箱', type: 'email', required: true, placeholder: 'john@example.com', example: 'john@example.com', maxLength: 100 },
  { name: 'phone', label: '手机号', type: 'tel', required: true, placeholder: '1234567890', example: '1234567890', minLength: 6, maxLength: 20, description: '纯数字，6-20 位' },
  { name: 'countryCode', label: '国家码', type: 'text', required: false, defaultValue: 'US', placeholder: 'US', example: 'US', minLength: 2, maxLength: 2, description: '2 位大写 ISO 国家码' },
  { name: 'addressLine1', label: '详细地址', type: 'text', required: true, placeholder: '123 Main Street', example: '123 Main Street', minLength: 2, maxLength: 200 },
  { name: 'city', label: '城市', type: 'text', required: true, placeholder: 'New York', example: 'New York', minLength: 1, maxLength: 100 },
  { name: 'state', label: '州/省', type: 'text', required: true, placeholder: 'NY', example: 'NY', minLength: 1, maxLength: 100 },
];

const CSV_HEADER = 'firstName,lastName,email,phone,countryCode,addressLine1,city,state';
const CSV_EXAMPLE = 'John,Doe,john@example.com,1234567890,US,123 Main Street,New York,NY';

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

// ── 校验函数 ──────────────────────────────────────────────────────────────────

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

export const uqpayCardholderAdapter: CardholderAdapter = {
  channelCode: 'UQPAY',

  getSchema(): CardholderFieldSchema {
    return {
      channelCode: 'UQPAY',
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
    const channel = db.prepare(
      "SELECT * FROM card_channels WHERE UPPER(channel_code) = 'UQPAY' AND status = 1"
    ).get() as any;
    if (!channel) throw new Error('UQPay 渠道未启用');
    if (!channel.api_base_url) throw new Error('UQPay 渠道 api_base_url 未配置');

    let config: Record<string, any> = {};
    try { config = JSON.parse(channel.config_json || '{}'); } catch (_) {}

    const { UqPaySDK } = await import('../../channels/uqpay');
    const sdk = new UqPaySDK({
      clientId: config.clientId || channel.api_key || '',
      apiKey: config.apiSecret || channel.api_secret || '',
      baseUrl: channel.api_base_url,
    });

    // UQPay getOrCreateCardholder 优先查找重复 email，不存在则创建
    const result = await sdk.getOrCreateCardholder({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phoneNumber: input.phone,
      countryCode: input.countryCode || 'US',
      userId: 0,
      database: null,
    });

    const cardholderId = result.cardholder_id || result.id || '';
    if (!cardholderId) throw new Error('UQPay 未返回 cardholder_id');

    return {
      externalId: cardholderId,
      status: result.cardholder_status || result.status || 'ACTIVE',
      kycStatus: result.cardholder_status || result.status || 'ACTIVE',
      rawResponse: result,
    };
  },

  getCsvTemplate(): string {
    return CSV_HEADER + '\n' + CSV_EXAMPLE + '\n';
  },
};

export const uqpayMaskUtils = { maskEmail, maskPhone };
