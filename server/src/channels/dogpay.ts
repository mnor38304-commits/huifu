/**
 * DogPay 发卡渠道 SDK
 *
 * 对接 DogPay 开放平台的 HTTP API（参考现有业务调用反推接口结构）
 *
 * Base URL: 从 card_channels.api_base_url 读取
 * 认证: appId + appSecret 签名方式
 */

import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DogPayConfig {
  appId: string;
  appSecret: string;
  apiBaseUrl: string;
}

export interface DogPayCardholder {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  countryCode: string;
  status: 'PENDING' | 'ACTIVE' | 'FAILED' | 'DISABLED';
  kycStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  updatedAt: string;
}

export interface DogPayCardholderCreate {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  countryCode?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
}

export interface DogPayCardholderList {
  page: number;
  pageSize: number;
  status?: string;
  keyword?: string;
}

// ─── SDK ──────────────────────────────────────────────────────────────────────

export class DogPaySDK {
  private appId: string;
  private appSecret: string;
  private baseUrl: string;

  constructor(config: DogPayConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.baseUrl = config.apiBaseUrl.replace(/\/$/, '');
  }

  // ── 内部: 签名请求 ───────────────────────────────────────────────────────────

  protected async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(8).toString('hex');
    const bodyStr = body ? JSON.stringify(body) : '';
    const signStr = `${method.toUpperCase()}${path}${timestamp}${nonce}${bodyStr}`;
    const signature = crypto
      .createHmac('sha256', this.appSecret)
      .update(signStr)
      .digest('hex');

    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-App-Id': this.appId,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        'X-Signature': signature,
      },
      body: body ? bodyStr : undefined,
    } as any);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DogPay API ${method} ${path} failed: ${response.status} ${errText}`);
    }

    const data = await response.json() as any;
    if (data.code !== 0 && data.code !== '0' && data.code !== 200 && response.status >= 400) {
      throw new Error(`DogPay API error: ${data.message || JSON.stringify(data)}`);
    }
    return data;
  }

  // ── 持卡人 API ──────────────────────────────────────────────────────────────

  /**
   * 创建持卡人
   */
  async createCardholder(params: DogPayCardholderCreate): Promise<DogPayCardholder> {
    const data = await this.request<any>('POST', '/api/v1/cardholders', {
      first_name: params.firstName,
      last_name: params.lastName,
      email: params.email,
      phone: params.phone,
      country_code: params.countryCode || 'US',
      address_line1: params.addressLine1 || '',
      city: params.city || '',
      state: params.state || '',
    });
    return this.mapCardholder(data.data || data);
  }

  /**
   * 获取持卡人详情
   */
  async getCardholder(id: string): Promise<DogPayCardholder> {
    const data = await this.request<any>('GET', `/api/v1/cardholders/${id}`);
    return this.mapCardholder(data.data || data);
  }

  /**
   * 持卡人列表
   */
  async listCardholders(params?: DogPayCardholderList): Promise<{ list: DogPayCardholder[]; total: number }> {
    const qs = new URLSearchParams({
      page: String(params?.page ?? 1),
      page_size: String(params?.pageSize ?? 20),
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.keyword ? { keyword: params.keyword } : {}),
    }).toString();

    const data = await this.request<any>('GET', `/api/v1/cardholders?${qs}`);
    const list = (data.data?.list || data.list || data.data || []).map((item: any) =>
      this.mapCardholder(item)
    );
    return { list, total: data.data?.total ?? data.total ?? list.length };
  }

  /**
   * 更新持卡人状态
   */
  async updateCardholderStatus(id: string, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
    await this.request('PUT', `/api/v1/cardholders/${id}`, { status });
  }

  // ── 内部: 字段映射（API 可能返回 snake_case 或 camelCase）────────────────────

  private mapCardholder(raw: any): DogPayCardholder {
    return {
      id: raw.id || raw.id || '',
      firstName: raw.first_name || raw.firstName || '',
      lastName: raw.last_name || raw.lastName || '',
      email: raw.email || '',
      phone: raw.phone || raw.phone_number || '',
      countryCode: raw.country_code || raw.countryCode || 'US',
      status: raw.status || 'PENDING',
      kycStatus: raw.kyc_status || raw.kycStatus || 'PENDING',
      createdAt: raw.created_at || raw.createdAt || '',
      updatedAt: raw.updated_at || raw.updatedAt || '',
    };
  }

  // ── 兼容: 开卡（现有业务已在用）──────────────────────────────────────────────

  async createCard(params: {
    cardType: 'virtual' | 'physical';
    cardName: string;
    channelId: string;
    cardholderId?: string;
  }): Promise<any> {
    return this.request('POST', '/api/v1/cards', params);
  }

  async freezeCard(cardId: string): Promise<any> {
    return this.request('POST', `/api/v1/cards/${cardId}/freeze`, {});
  }

  async unfreezeCard(cardId: string): Promise<any> {
    return this.request('POST', `/api/v1/cards/${cardId}/unfreeze`, {});
  }

  async deleteCard(cardId: string): Promise<any> {
    return this.request('DELETE', `/api/v1/cards/${cardId}`, {});
  }

  // ── BIN / 充值 / C2C ─────────────────────────────────────────────────────

  async getCardBins(): Promise<any> {
    return this.request('GET', '/api/v1/card-bins');
  }

  async getCardProducts(): Promise<any> {
    return this.request('GET', '/api/v1/products');
  }

  async getDepositAddress(cardholderIdOrChain: string | { chain: string }): Promise<any> {
    if (typeof cardholderIdOrChain === 'string') {
      return this.request('GET', `/api/v1/cardholders/${cardholderIdOrChain}/deposit-address`);
    }
    // { chain: 'trx' | 'eth' | 'bnb' } — 全局充值地址
    return this.request('GET', `/api/v1/deposit-address?chain=${cardholderIdOrChain.chain}`);
  }

  async createC2COrder(params: any): Promise<any> {
    return this.request('POST', '/api/v1/c2c-orders', params);
  }

  async getC2COrderDetail(orderId: string): Promise<any> {
    return this.request('GET', `/api/v1/c2c-orders/${orderId}`);
  }
}
