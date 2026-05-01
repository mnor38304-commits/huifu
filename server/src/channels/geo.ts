/**
 * GEO / InfiniaX 发卡渠道 SDK
 *
 * Base URL: 从 card_channels.api_base_url 读取
 * 认证: Basic Auth (apiKey:apiSecret → Base64)
 * 沙盒: https://uat-vccmmr.infiniax.com
 */

import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeoConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
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
}

export interface GeoSpendingLimit {
  limit: number;
  netConsumption: number;
  surplusLimit: number;
}

export interface GeoShareItem {
  id: string;
  name?: string;
  limit?: number;
  [key: string]: any;
}

export interface GeoShareList {
  total: number;
  list: GeoShareItem[];
}

export interface GeoCardCreateParams {
  binId: string;
  cardName: string;
  cardLimit: number;
  currency?: string;
  userId: number;
  metadata?: Record<string, string>;
  shareId?: string;
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
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor(config: GeoConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  // ── 内部: 通用请求 ───────────────────────────────────────────────────────────

  protected getAuthHeader(): string {
    const auth = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
    return `Basic ${auth}`;
  }

  protected sanitizeLog(data: any): any {
    if (!data) return data;
    const sanitized = JSON.parse(JSON.stringify(data));
    const sensitiveKeys = ['apiKey', 'apiSecret', 'Authorization', 'authorization', 'pan', 'PAN', 'cvv', 'CVV', 'cardNo', 'cardNumber', 'card_no'];
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
    recurse(sanitized);
    return sanitized;
  }

  async request<T>(method: string, path: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams(query).toString();
      url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      'Authorization': this.getAuthHeader(),
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(this.sanitizeLog(body)) : undefined,
    } as any);

    let rawData: any;
    try {
      rawData = await response.json();
    } catch {
      const text = await response.text();
      throw new Error(`GEO API ${method} ${path} failed: ${response.status} (non-JSON response: ${text.slice(0, 200)})`);
    }

    if (!response.ok) {
      const msg = rawData?.message || rawData?.errorMsg || rawData?.error || JSON.stringify(rawData).slice(0, 200);
      throw new Error(`GEO API ${method} ${path} failed: ${response.status} - ${msg}`);
    }

    // GEO may return { code: 0, data: ... }
    if (rawData.code !== undefined && rawData.code !== null && rawData.code !== 0 && rawData.code !== '0' && rawData.code !== 200) {
      const msg = rawData.message || rawData.errorMsg || `code=${rawData.code}`;
      throw new Error(`GEO API error: ${msg}`);
    }

    return rawData.data !== undefined ? rawData.data : rawData;
  }

  // ── 账户余额 ──────────────────────────────────────────────────────────────

  async getAccountBalance(): Promise<GeoAccountBalance> {
    const data = await this.request<any>('GET', '/open-api/v1/account/balance');
    return {
      availableBalance: data.availableBalance ?? data.available_balance ?? data.available ?? 0,
      pendingBalance: data.pendingBalance ?? data.pending_balance ?? data.pending ?? 0,
      rawJson: data,
    };
  }

  // ── 可用 BIN ─────────────────────────────────────────────────────────────

  async listBins(): Promise<GeoBin[]> {
    const data = await this.request<any>('GET', '/open-api/v1/cards/bins');
    const list = Array.isArray(data) ? data : (data.list || data.data || []);
    return list.map((item: any) => this.normalizeBin(item));
  }

  private normalizeBin(raw: any): GeoBin {
    return {
      id: raw.id || raw.binId || raw.bin_id || '',
      bin: raw.bin || raw.binCode || raw.bin_code || '',
      organization: raw.organization || raw.cardBrand || raw.card_brand || raw.issuer || '',
      issuerCountry: raw.issuerCountry || raw.issuer_country || raw.country || null,
      type: raw.type || raw.cardType || raw.card_type || '',
      limit: raw.limit ?? raw.cardLimit ?? raw.card_limit ?? raw.spendingLimit ?? 0,
      currency: raw.currency || 'USD',
      supportAvs: raw.supportAvs ?? raw.support_avs ?? false,
      support3ds: raw.support3ds ?? raw.support_3ds ?? false,
      channelName: raw.channelName || raw.channel_name || '',
      status: raw.status || 'active',
      createdAt: raw.createdAt || raw.created_at || '',
      order: raw.order || '',
      supportAirlines: raw.supportAirlines ?? raw.support_airlines ?? null,
    };
  }

  // ── 额度信息 ──────────────────────────────────────────────────────────────

  async getSpendingLimit(): Promise<GeoSpendingLimit> {
    const data = await this.request<any>('GET', '/open-api/v1/cards/spending/limit');
    return {
      limit: data.limit ?? data.spendingLimit ?? 0,
      netConsumption: data.netConsumption ?? data.net_consumption ?? 0,
      surplusLimit: data.surplusLimit ?? data.surplus_limit ?? 0,
    };
  }

  // ── 共享组 ──────────────────────────────────────────────────────────────

  async listShares(): Promise<GeoShareList> {
    const data = await this.request<any>('GET', '/open-api/v1/share');
    return {
      total: data.total ?? (Array.isArray(data.list) ? data.list.length : 0),
      list: (data.list || data.data || []).map((item: any) => ({
        id: item.id || item.shareId || item.share_id || '',
        name: item.name || item.shareName || item.share_name || '',
        limit: item.limit ?? item.shareLimit ?? item.share_limit,
        ...item,
      })),
    };
  }

  // ── 开卡 ──────────────────────────────────────────────────────────────

  /**
   * 创建卡片
   *
   * 输入参数会被映射到 GEO 文档真实字段。
   * 如果 GEO 文档字段不同，请以此方法内的实际映射为准。
   */
  async createCard(params: GeoCardCreateParams): Promise<GeoCard> {
    // 构建 GEO API 请求体
    const body: Record<string, unknown> = {
      binId: params.binId,
      cardName: params.cardName,
      cardLimit: params.cardLimit,
      currency: params.currency || 'USD',
    };

    if (params.shareId) {
      body.shareId = params.shareId;
    }

    if (params.metadata && Object.keys(params.metadata).length > 0) {
      body.metadata = params.metadata;
    }

    const data = await this.request<any>('POST', '/open-api/v1/cards', body);
    return this.normalizeCard(data);
  }

  private normalizeCard(raw: any): GeoCard {
    const cardData = raw.data || raw.card || raw;
    return {
      cardId: cardData.cardId || cardData.card_id || cardData.id || '',
      status: cardData.status || cardData.cardStatus || cardData.card_status || 'PENDING',
      cardNoMasked: cardData.cardNoMasked || cardData.card_no_masked || cardData.maskedPan || `****${(cardData.last4 || cardData.last4 || '').slice(-4)}` || '',
      last4: cardData.last4 || (cardData.cardNoMasked || '').slice(-4) || undefined,
      expireDate: cardData.expireDate || cardData.expire_date || cardData.expiry || undefined,
      balance: cardData.balance ?? cardData.cardBalance ?? undefined,
      rawJson: this.sanitizeLog(raw),
    };
  }

  // ── 状态映射 ──────────────────────────────────────────────────────────────

  /**
   * 将 GEO 状态映射为本地 cards.status
   */
  static mapStatus(geoStatus: string): number {
    const s = (geoStatus || '').toLowerCase();
    if (['active', 'success', 'activated'].includes(s)) return 1;
    if (['pending', 'processing', 'created'].includes(s)) return 0;
    if (['frozen', 'suspended', 'disabled', 'paused'].includes(s)) return 2;
    if (['expired', 'expiring'].includes(s)) return 3;
    if (['canceled', 'cancelled', 'closed', 'deleted'].includes(s)) return 4;
    return 0; // 默认待激活
  }
}
