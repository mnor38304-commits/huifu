/**
 * GEO / InfiniaX 发卡渠道 SDK
 *
 * API 网关: https://uat-openapi.geo.sh.cn/ (沙盒) / https://openapi.geo.sh.cn/ (生产)
 * 认证: RSA 1024 + Base64 + Hex 4 参数请求模式
 *
 * 请求:
 *   dataContent = privateEncrypt(JSON -> Base64)
 *   使用 privateKey (我方 RSA 1024 私钥)
 *
 * 响应:
 *   result = publicDecrypt(Hex -> Base64 -> JSON)
 *   使用 geoPublicKey (GEO App 公钥, GEO 后台不可编辑)
 *
 * GEO 后台配置:
 *   客户公钥 (可编辑) = customerPublicKey, 与 privateKey 配对
 *   App 公钥 (不可编辑) = geoPublicKey, 用于解密 GEO 响应
 *
 * 参考: geo.zip Java 示例
 *   GeoReq.buildParam: privateEncrypt(body, priKey)
 *   GeoPayQryCardService: publicDecrypt(result, pubKey)
 */

import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeoConfig {
  baseUrl: string;
  userNo: string;
  privateKey: string;       // 我方 RSA 1024 私钥, 用于请求 dataContent 加密 (privateEncrypt)
  geoPublicKey: string;     // GEO App 公钥 (不可编辑), 用于响应 result 解密 (publicDecrypt)
  customerPublicKey: string; // 我方公钥, 和 privateKey 配对, 配置到 GEO 后台客户公钥位置
}

export interface GeoBin {
  cardBin: string;
  cardBrand: string;
  currency: string;
}

export interface GeoCardCreateParams {
  userId: number;
  cardName: string;
  cardLimit: number;
  currency?: string;
  binRangeId: string;
  validityYears?: number;
  cardUserId?: string;     // GEO 持卡人标识，正式环境必填
}

export interface GeoCard {
  cardId: string;
  cardNo: string;         // 完整卡号（仅用于前端临时展示，不落库）
  cardVerifyNo: string;   // CVV（仅用于前端临时展示，不落库）
  cardExpiryDate: string; // yyyy-MM (如 2028-12)
  status: string;         // GEO cardStatus
  rawJson: any;
}

export interface GeoCardholderCreateParams {
  userReqNo: string;
  cardUserId: string;     // GEO 持卡人标识: GEOU{userId}{timestamp}
  mobile: string;          // 手机号
  mobilePrefix: string;    // 手机号国际区号，如 86（不带 +）
  email: string;
  firstName: string;
  lastName: string;
  birthDate: string;       // yyyy-MM-dd
  billingCity: string;
  billingState: string;
  billingAddress: string;
  billingZipCode: string;
  countryCode: string;     // 国家代码，中国传 CNH
}

export interface GeoCardholder {
  cardUserId: string;     // GEO 返回确认的持卡人 ID
  status: string;
  rawJson: any;
}

/**
 * 生成 GEO 持卡人标识
 * 格式: GEOU + userId + 时间戳（yyyyMMddHHmmss）+ 4 位随机数
 * 示例: GEOU9202605021514001234
 * 长度约 27 字符
 */
export function generateGeoCardUserId(userId: number): string {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `GEOU${userId}${ts}${rand}`;
}

// ─── SDK ──────────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 117;   // RSA 1024 PKCS#1 单块最大明文
const HEX_CHUNK = 256;    // RSA 1024 单块加密后 hex 长度

export class GeoSdk {
  private baseUrl: string;
  private userNo: string;
  private privateKey: string;
  private geoPublicKey: string;
  private customerPublicKey: string;

  constructor(config: GeoConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.userNo = config.userNo;
    this.privateKey = config.privateKey;
    this.geoPublicKey = config.geoPublicKey || '';
    this.customerPublicKey = config.customerPublicKey || '';
  }

  // ── 密钥格式化 ──────────────────────────────────────────────────────────

  private fmtPrivateKey(raw: string): string {
    let k = raw.replace(/-----BEGIN .*? KEY-----/g, '').replace(/-----END .*? KEY-----/g, '').replace(/\s+/g, '');
    return '-----BEGIN RSA PRIVATE KEY-----\n' + (k.match(/.{1,64}/g)?.join('\n') || k) + '\n-----END RSA PRIVATE KEY-----';
  }

  private fmtPublicKey(raw: string): string {
    let k = raw.replace(/-----BEGIN .*? KEY-----/g, '').replace(/-----END .*? KEY-----/g, '').replace(/\s+/g, '');
    // Node.js requires X.509 SPKI format (-----BEGIN PUBLIC KEY-----) for publicDecrypt
    return '-----BEGIN PUBLIC KEY-----\n' + (k.match(/.{1,64}/g)?.join('\n') || k) + '\n-----END PUBLIC KEY-----';
  }

  // ── RSA 分块加密 ─────────────────────────────────────────────────────────

  /**
   * 加密业务参数为 dataContent
   * 步骤: JSON.stringify -> Base64 -> 分块 privateEncrypt -> hex 拼接
   */
  encryptPayload(payload: Record<string, unknown>): string {
    const jsonStr = JSON.stringify(payload);
    const base64Str = Buffer.from(jsonStr, 'utf-8').toString('base64');
    const buf = Buffer.from(base64Str, 'utf-8');
    const pemKey = this.fmtPrivateKey(this.privateKey);
    const chunks: string[] = [];
    for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
      const chunk = buf.slice(i, i + CHUNK_SIZE);
      const encrypted = crypto.privateEncrypt(
        { key: pemKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        chunk
      );
      chunks.push(encrypted.toString('hex'));
    }
    return chunks.join('');
  }

  /**
   * 解密 GEO 返回的 result 字段
   * 使用 geoPublicKey (GEO App 公钥) 解密
   * 步骤: 按 256 hex 字符分块 -> publicDecrypt -> 拼接 -> Base64 解码 -> JSON
   */
  decryptResponse(hexData: string): any {
    const pemKey = this.fmtPublicKey(this.geoPublicKey);
    const bufs: Buffer[] = [];
    for (let i = 0; i < hexData.length; i += HEX_CHUNK) {
      const hexChunk = hexData.slice(i, i + HEX_CHUNK);
      const decrypted = crypto.publicDecrypt(
        { key: pemKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(hexChunk, 'hex')
      );
      bufs.push(decrypted);
    }
    const base64Str = Buffer.concat(bufs).toString('utf-8');
    const jsonStr = Buffer.from(base64Str, 'base64').toString('utf-8');
    return JSON.parse(jsonStr);
  }

  // ── 脱敏 ──────────────────────────────────────────────────────────────

  sanitizeLog(data: any): any {
    if (!data) return data;
    const s = JSON.parse(JSON.stringify(data));
    const keys = ['privateKey', 'publicKey', 'priKey', 'pubKey', 'Authorization',
      'pan', 'PAN', 'cvv', 'CVV', 'cardNo', 'cardNumber', 'card_no',
      'cardVerifyNo', 'userNo', 'dataContent', 'result'];
    const recurse = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      for (const key of Object.keys(obj)) {
        if (keys.some(k => key.toLowerCase().includes(k.toLowerCase())) && typeof obj[key] === 'string' && obj[key].length > 4) {
          obj[key] = obj[key].slice(0, 4) + '***REDACTED***';
        } else if (typeof obj[key] === 'object') {
          recurse(obj[key]);
        }
      }
    };
    recurse(s);
    return s;
  }

  // ── 通用 RSA 请求 ──────────────────────────────────────────────────────

  async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const url = this.baseUrl + path;
    const dataContent = this.encryptPayload(body || {});
    const requestBody = {
      version: '1.0.0',
      userNo: this.userNo,
      dataType: 'JSON',
      dataContent,
    };

    console.log('[GEO]', method, path, 'req(脱敏):', JSON.stringify(this.sanitizeLog(requestBody)).slice(0, 300));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    } as any);

    if (!response.ok) {
      const text = await response.text();
      throw new Error('GEO API ' + path + ' failed: ' + response.status + ' - ' + text.slice(0, 200));
    }

    const rawData: any = await response.json();
    console.log('[GEO]', path, 'resp(脱敏):', JSON.stringify(this.sanitizeLog(rawData)).slice(0, 300));

    if (rawData.success === true) {
      if (rawData.async === true) {
        console.warn('[GEO]', path, 'async=true, result will be notified via callback');
        return rawData.result as T;
      }
      if (rawData.result) {
        try {
          return this.decryptResponse(rawData.result) as T;
        } catch (decErr: any) {
          console.error('[GEO] response decrypt failed:', decErr.message);
          throw new Error('GEO response decrypt failed: ' + decErr.message);
        }
      }
    }

    throw new Error('GEO API error: success=' + rawData.success + ', async=' + rawData.async + ', statusCode=' + rawData.statusCode + ', msg=' + (rawData.message || ''));
  }

  // ── BIN 查询 ──────────────────────────────────────────────────────────

  async listBins(): Promise<GeoBin[]> {
    const data: any = await this.request('POST', '/openapi/vcc/cardBin', { userReqNo: crypto.randomUUID() });
    const list: any[] = data.data || data.list || [];
    return list.map((item: any) => ({
      cardBin: item.cardBin || item.binRangeId || item.cardBinId || item.id || '',
      cardBrand: item.cardBrand || item.brand || '',
      currency: item.currency || 'USD',
    }));
  }

  // ── 开卡 ──────────────────────────────────────────────────────────────

  async createCard(params: GeoCardCreateParams): Promise<GeoCard> {
    const now = new Date();
    const y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const startDate = y + '-' + M + '-' + d;
    const validityYears = params.validityYears || 2;
    const endDt = new Date(now.getFullYear() + validityYears, now.getMonth(), now.getDate());
    const endDate = endDt.getFullYear() + '-' + String(endDt.getMonth() + 1).padStart(2, '0') + '-' + String(endDt.getDate()).padStart(2, '0');

    // 固定 payload 格式，不传 groupId/shareId/shareGroupId/poolId/sharedAccountId/enableMultiUse
    const body: Record<string, unknown> = {
      userReqNo: crypto.randomUUID(),
      localCurrency: params.currency || 'USD',
      startDate: startDate,
      endDate: endDate,
      enableCurrencyCheck: 1,
      authLimitAmount: params.cardLimit,
      binRangeId: params.binRangeId,
      channelType: 1,
      CardAlias: params.cardName || 'GEO Card',
    };

    // cardUserId: GEO 正式环境开卡必填（商户端持卡人标识）
    if (params.cardUserId) {
      body.cardUserId = params.cardUserId;
    }

    const data: any = await this.request('POST', '/openapi/vcc/card/apply', body);

    return {
      cardId: data.cardId || '',
      cardNo: data.cardNo || '',
      cardVerifyNo: data.cardVerifyNo || '',
      cardExpiryDate: data.cardExpiryDate || endDate.substring(0, 7),
      status: '1',
      rawJson: this.sanitizeLog(data),
    };
  }

  // ── 卡信息查询 ──────────────────────────────────────────────────────────

  async getCardInfo(cardId: string): Promise<GeoCard> {
    const data: any = await this.request('POST', '/openapi/vcc/card/info', { cardId });

    let status = '0';
    if (data.cardStatus === '1') status = '1';
    else if (data.cardStatus === '0') status = '4';
    else if (data.cardStatus === '2') status = '2';

    return {
      cardId: data.cardId || cardId,
      cardNo: data.cardNo || '',
      cardVerifyNo: data.cardVerifyNo || '',
      cardExpiryDate: data.cardExpiryDate || '',
      status: status,
      rawJson: this.sanitizeLog(data),
    };
  }

  // ── 持卡人申请 ─────────────────────────────────────────────────────────

  /**
   * 申请注册 GEO 持卡人
   * 返回的 cardUserId 是后续开卡时必须使用的字段
   */
  async createCardholder(params: GeoCardholderCreateParams): Promise<GeoCardholder> {
    const body: Record<string, unknown> = {
      userReqNo: params.userReqNo,
      cardUserId: params.cardUserId,
      mobile: params.mobile,
      mobilePrefix: params.mobilePrefix,
      email: params.email,
      firstName: params.firstName,
      lastName: params.lastName,
      birthDate: params.birthDate,
      billingCity: params.billingCity,
      billingState: params.billingState,
      billingAddress: params.billingAddress,
      billingZipCode: params.billingZipCode,
      countryCode: params.countryCode,
    };

    const data: any = await this.request('POST', '/openapi/vcc/cardholder/apply', body);

    return {
      cardUserId: data.cardUserId || params.cardUserId,
      status: data.status || '1',
      rawJson: this.sanitizeLog(data),
    };
  }

  // ── 状态映射 ──────────────────────────────────────────────────────────

  /**
   * 将 GEO cardStatus 映射为本地 cards.status
   * Java 参考: GeoPayQryCardService
   *   cardStatus=1 -> status=1 (正常)
   *   cardStatus=0 -> status=4 (已注销)
   *   cardStatus=2 -> status=2 (冻结)
   */
  static mapStatus(geoStatus: string): number {
    if (geoStatus === '1') return 1;
    if (geoStatus === '0') return 4;
    if (geoStatus === '2') return 2;
    return 0;
  }
}
