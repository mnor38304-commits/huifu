/**
 * GEO / InfiniaX 发卡渠道 SDK
 *
 * API 网关: https://uat-openapi.geo.sh.cn/ (沙盒) / https://openapi.geo.sh.cn/ (生产)
 * 认证: RSA 1024 + Base64 + Hex 4 参数请求模式
 *
 * 请求参数:
 *   version: "1.0.0"
 *   userNo: 商户号 (字符串, 最长 19 位)
 *   dataType: "JSON" (固定)
 *   dataContent: 业务参数 JSON → Base64 → RSA 1024 加密 → Hex
 *
 * 响应解密:
 *   result 字段 (Hex) → RSA 1024 解密 → Base64 解码 → JSON
 *
 * 密钥说明:
 *   - appPublicKey = GEO 平台公钥 = 客户公钥 (App 公钥与客户公钥为同一把 RSA 1024 公钥)
 *   - 由 GEO 签发,用于: 1) 请求 dataContent 加密 (publicEncrypt) 2) 响应 result 解密 (publicDecrypt)
 */

import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeoConfig {
  baseUrl: string;
  userNo: string;
  appPublicKey: string;  // GEO 平台 RSA 公钥 (PKCS#1 PEM)
  authMode?: 'RSA_4_PARAMS' | 'BASIC_AUTH';
}

export interface GeoAccountBalance {
  availableBalance: number;
  pendingBalance: number;
  rawJson: any;
}

export interface GeoBin {
  id: string;
  bin: string;
  organization: string;
  issuerCountry?: string | null;
  type: string;
  limit: number;
  currency: string;
  supportAvs?: boolean;
  support3ds?: boolean;
  channelName?: string;
  status: string;
  createdAt?: string;
  order?: string;
  supportAirlines?: boolean | null;
  modeType?: 'SINGLE' | 'SHARE' | string;
  isSingle: boolean;
}

export interface GeoSpendingLimit {
  limit: number;
  netConsumption: number;
  surplusLimit: number;
}

export interface GeoCardCreateParams {
  binId: string;
  cardName: string;
  cardLimit: number;
  currency?: string;
  userId: number;
  metadata?: Record<string, string>;
}

export interface GeoCard {
  cardId: string;
  status: string;
  cardNoMasked: string;
  last4?: string;
  expireDate?: string;
  balance?: number;
  rawJson: any;
}

// ─── SDK ──────────────────────────────────────────────────────────────────────

export class GeoSdk {
  private baseUrl: string;
  private userNo: string;
  private appPublicKey: string;
  private authMode: 'RSA_4_PARAMS' | 'BASIC_AUTH';

  constructor(config: GeoConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.userNo = config.userNo;
    this.appPublicKey = config.appPublicKey;
    this.authMode = config.authMode || 'RSA_4_PARAMS';
  }

  /**
   * 确认 RSA 配置是否完整
   */
  isRsaConfigured(): boolean {
    return !!(this.userNo && this.appPublicKey);
  }

  /**
   * 格式化 PEM 公钥 — 确保 RSA 1024 公钥有正确 PEM 头尾
   */
  private formatRsaPublicKey(rawKey: string): string {
    let cleaned = rawKey.replace(/-----BEGIN RSA PUBLIC KEY-----/g, '')
                       .replace(/-----END RSA PUBLIC KEY-----/g, '')
                       .replace(/-----BEGIN PUBLIC KEY-----/g, '')
                       .replace(/-----END PUBLIC KEY-----/g, '')
                       .replace(/\s+/g, '')
                       .replace(/\n/g, '');

    // PKCS#1 (RSA PUBLIC KEY)
    if (cleaned.length > 100 && !cleaned.startsWith('MIGf') && !cleaned.startsWith('MF')) {
      // Likely already clean
    }

    return [
      '-----BEGIN PUBLIC KEY-----',
      cleaned.match(/.{1,64}/g)?.join('\n') || cleaned,
      '-----END PUBLIC KEY-----',
    ].join('\n');
  }

  // ── 加密: JSON → Base64 → RSA 加密 → Hex ──────────────────────────────

  /**
   * 加密业务参数为 dataContent（RSA 1024）
   * 步骤: JSON.stringify → Base64 → RSA 1024 公钥加密 → Hex
   */
  encryptPayload(payload: Record<string, unknown>): string {
    const jsonStr = JSON.stringify(payload);
    const base64Str = Buffer.from(jsonStr, 'utf-8').toString('base64');
    const pemKey = this.formatRsaPublicKey(this.appPublicKey);
    const encrypted = crypto.publicEncrypt(
      {
        key: pemKey,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(base64Str, 'utf-8')
    );
    return encrypted.toString('hex');
  }

  // ── 解密: Hex → RSA 解密 → Base64 解码 → JSON ────────────────────────

  /**
   * 解密 GEO 返回的 result 字段
   * 步骤: Hex → RSA 公钥解密 → Base64 解码 → JSON
   */
  decryptResponse(hexData: string): any {
    const pemKey = this.formatRsaPublicKey(this.appPublicKey);
    const decrypted = crypto.publicDecrypt(
      {
        key: pemKey,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(hexData, 'hex')
    );
    const base64Str = decrypted.toString('utf-8');
    const jsonStr = Buffer.from(base64Str, 'base64').toString('utf-8');
    return JSON.parse(jsonStr);
  }

  // ── 脱敏 ──────────────────────────────────────────────────────────────

  sanitizeLog(data: any): any {
    if (!data) return data;
    const s = JSON.parse(JSON.stringify(data));
    const sensitiveKeys = ['apiKey', 'apiSecret', 'Authorization', 'authorization',
      'pan', 'PAN', 'cvv', 'CVV', 'cardNo', 'cardNumber', 'card_no',
      'appPublicKey', 'appPrivateKey', 'geoPublicKey', 'userNo'];
    const recurse = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      for (const key of Object.keys(obj)) {
        if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
          obj[key] = '***REDACTED***';
        } else if (typeof obj[key] === 'object') {
          recurse(obj[key]);
        }
      }
    };
    recurse(s);
    return s;
  }

  // ── 通用 RSA 请求 ──────────────────────────────────────────────────────

  async request<T>(method: string, path: string, body?: Record<string, unknown>, _query?: Record<string, string>): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    // 构建 RSA 4 参数请求体
    const payload: Record<string, unknown> = {
      ...(body || {}),
    };
    if (method !== 'GET') {
      payload._method = method;
    }

    const dataContent = this.encryptPayload(payload);

    const requestBody = {
      version: '1.0.0',
      userNo: this.userNo,
      dataType: 'JSON',
      dataContent,
    };

    console.log('[GEO]', path, 'req:', JSON.stringify(this.sanitizeLog(requestBody)).slice(0, 300));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    } as any);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GEO API ${path} failed: ${response.status} - ${text.slice(0, 200)}`);
    }

    const rawData: any = await response.json();

    if (rawData.success === false || rawData.success === 'false') {
      throw new Error(`GEO API error: [${rawData.errorCode}] ${rawData.errorMsg || 'unknown error'}`);
    }

    if (rawData.async === true) {
      console.warn(`[GEO] ${path} 返回 async=true，结果将通过回调通知`);
      return rawData.result as T;
    }

    // result 字段是 Hex → 需要 RSA 解密 → Base64 解码 → JSON
    if (rawData.result) {
      try {
        const decrypted = this.decryptResponse(rawData.result);
        return decrypted as T;
      } catch (decErr: any) {
        console.error(`[GEO] result 解密失败:`, decErr.message);
        throw new Error(`GEO 响应解密失败: ${decErr.message}`);
      }
    }

    // 如果没有 result 字段但 success=true，返回整个 data
    return rawData.data !== undefined ? rawData.data : rawData as T;
  }

  // ── 账户余额 ──────────────────────────────────────────────────────────

  async getAccountBalance(): Promise<GeoAccountBalance> {
    const data = await this.request<any>('POST', '/account/balance');
    return {
      availableBalance: data.availableBalance ?? data.available_balance ?? data.available ?? 0,
      pendingBalance: data.pendingBalance ?? data.pending_balance ?? data.pending ?? 0,
      rawJson: data,
    };
  }

  // ── 可用 BIN ─────────────────────────────────────────────────────────

  async listBins(): Promise<GeoBin[]> {
    const data = await this.request<any>('POST', '/cards/bins');
    const list = Array.isArray(data) ? data : (data.list || data.data || []);
    return list.map((item: any) => this.normalizeBin(item));
  }

  getSingleBins(bins: GeoBin[]): GeoBin[] {
    return bins.filter(b => b.isSingle === true);
  }

  private normalizeBin(raw: any): GeoBin {
    // GEO real field: cardType (1=常规卡/SINGLE), also check common names
    let modeValue = '';
    if (raw.cardType === 1 || raw.cardType === '1') { modeValue = 'SINGLE'; }
    else if (raw.cardType === 2 || raw.cardType === '2') { modeValue = 'SHARE'; }
    else { modeValue = raw.mode || raw.modeType || raw.cardMode || raw.accountType || raw.settlementType || raw.shareType || ''; }
    const modeUpper = (modeValue || '').toString().toUpperCase();
    const isSingle = modeUpper === 'SINGLE' || modeUpper === 'INDIVIDUAL' || modeUpper === 'SINGLE_ACCOUNT';
    const modeType = isSingle ? 'SINGLE' as const : (['SHARE', 'GROUP', 'POOL'].includes(modeUpper) ? 'SHARE' as const : undefined);

    return {
      id: raw.id || raw.binId || raw.bin_id || '',
      bin: raw.bin || raw.binCode || raw.bin_code || '',
      organization: raw.organization || raw.cardBrand || raw.card_brand || raw.issuer || '',
      issuerCountry: raw.issuerCountry || raw.issuer_country || raw.country || null,
      type: String(raw.type || raw.cardType || raw.card_type || ''),
      limit: raw.limit ?? raw.cardLimit ?? raw.card_limit ?? raw.spendingLimit ?? 0,
      currency: raw.currency || 'USD',
      supportAvs: raw.supportAvs ?? raw.support_avs ?? false,
      support3ds: raw.support3ds ?? raw.support_3ds ?? false,
      channelName: raw.channelName || raw.channel_name || '',
      status: raw.status || 'active',
      createdAt: raw.createdAt || raw.created_at || '',
      order: raw.order || '',
      supportAirlines: raw.supportAirlines ?? raw.support_airlines ?? null,
      modeType,
      isSingle,
    };
  }

  // ── 额度信息 ──────────────────────────────────────────────────────────

  async getSpendingLimit(): Promise<GeoSpendingLimit> {
    const data = await this.request<any>('POST', '/cards/spending/limit');
    return {
      limit: data.limit ?? data.spendingLimit ?? 0,
      netConsumption: data.netConsumption ?? data.net_consumption ?? 0,
      surplusLimit: data.surplusLimit ?? data.surplus_limit ?? 0,
    };
  }

  // ── 开卡 ──────────────────────────────────────────────────────────────

  async createCard(params: GeoCardCreateParams): Promise<GeoCard> {
    const body: Record<string, unknown> = {
      binId: params.binId,
      cardName: params.cardName,
      cardLimit: params.cardLimit,
      currency: params.currency || 'USD',
      cardType: 1, // 1=常规卡(独立额度/SINGLE)，GEO 官方字段
    };

    if (params.metadata && Object.keys(params.metadata).length > 0) {
      body.metadata = params.metadata;
    }

    const data = await this.request<any>('POST', '/cards', body);
    return this.normalizeCard(data);
  }

  private normalizeCard(raw: any): GeoCard {
    const cardData = raw.data || raw.card || raw;
    return {
      cardId: cardData.cardId || cardData.card_id || cardData.id || '',
      status: cardData.status || cardData.cardStatus || cardData.card_status || 'PENDING',
      cardNoMasked: cardData.cardNoMasked || cardData.card_no_masked || cardData.maskedPan || `****${(cardData.last4 || '').slice(-4)}` || '',
      last4: cardData.last4 || (cardData.cardNoMasked || '').slice(-4) || undefined,
      expireDate: cardData.expireDate || cardData.expire_date || cardData.expiry || undefined,
      balance: cardData.balance ?? cardData.cardBalance ?? undefined,
      rawJson: this.sanitizeLog(raw),
    };
  }

  // ── 状态映射 ──────────────────────────────────────────────────────────

  static mapStatus(geoStatus: string): number {
    const s = (geoStatus || '').toLowerCase();
    if (['active', 'success', 'activated'].includes(s)) return 1;
    if (['pending', 'processing', 'created'].includes(s)) return 0;
    if (['frozen', 'suspended', 'disabled', 'paused'].includes(s)) return 2;
    if (['expired', 'expiring'].includes(s)) return 3;
    if (['canceled', 'cancelled', 'closed', 'deleted'].includes(s)) return 4;
    return 0;
  }
}
