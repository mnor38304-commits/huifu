/**
 * UQPay Issuing API SDK
 * 文档: https://docs.uqpay.com
 *
 * Base URL:
 *   Sandbox: https://api-sandbox.uqpaytech.com
 *   Production: https://api.uqpaytech.com
 *
 * 认证方式:
 *   1. POST /api/v1/connect/token → 获取 auth_token (x-auth-token header)
 *   2. 后续所有请求在 header 中传 x-auth-token
 */

import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UqPayConfig {
  clientId: string;
  apiKey: string;
  /** 默认 sandbox，生产环境替换 */
  baseUrl?: string;
}

export interface UqPayToken {
  auth_token: string;
  expired_at: string;
}

export interface UqPayCardholder {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  country_code: string;
  phone_number: string;
  status: 'PENDING' | 'SUCCESS' | 'INCOMPLETE' | 'FAILED';
  created_at: string;
  updated_at: string;
}

export interface UqPayCardProduct {
  id: string;
  name: string;
  currency: string;
  card_network: string;
  card_type: string;
  status: string;
}

export interface UqPayCard {
  id: string;
  cardholder_id: string;
  card_product_id: string;
  last4: string;
  expiry_month: string;
  expiry_year: string;
  status: 'PENDING' | 'ACTIVE' | 'FROZEN' | 'BLOCKED' | 'CANCELLED' | 'LOST' | 'STOLEN' | 'FAILED';
  currency: string;
  card_limit: number;
  created_at: string;
  updated_at: string;
  card_number?: string; // 明文卡号仅在创建时返回一次，后续需从渠道平台获取
  cvv?: string;          // 同上
}

export interface UqPayTransfer {
  id: string;
  source_account_id: string;
  target_account_id: string;
  currency: string;
  amount: string;
  status: 'pending' | 'completed' | 'failed';
  reason: string;
  created_at: string;
}

// ─── SDK ───────────────────────────────────────────────────────────────────────

export class UqPaySDK {
  private clientId: string;
  private apiKey: string;
  private baseUrl: string;
  private _token: string | null = null;
  private _tokenExpiredAt: Date | null = null;

  // cardholder 缓存（平台内只创建一次，避免重复）
  private _cachedCardholderId: string | null = null;

  constructor(config: UqPayConfig) {
    this.clientId = config.clientId;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api-sandbox.uqpaytech.com';
  }

  // ── Private: Token 管理 ───────────────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    // token 剩余 5 分钟内提前刷新
    if (
      this._token &&
      this._tokenExpiredAt &&
      this._tokenExpiredAt.getTime() - Date.now() > 5 * 60 * 1000
    ) {
      return this._token;
    }
    return this.refreshToken();
  }

  private async refreshToken(): Promise<string> {
    const url = `${this.baseUrl}/api/v1/connect/token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-client-id': this.clientId,
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[UqPay] Token 刷新失败: ${res.status} ${body}`);
    }

    const data: UqPayToken = await res.json() as UqPayToken;
    this._token = data.auth_token;
    this._tokenExpiredAt = new Date(data.expired_at);
    console.log('[UqPay] Token 刷新成功，有效至:', data.expired_at);
    return this._token;
  }

  // ── Private: 通用请求 ────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: object,
    options: Record<string, string> = {}
  ): Promise<T> {
    const token = await this.ensureToken();
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-auth-token': token,
      'x-idempotency-key': randomUUID(),
      ...options,
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // 401 → token 过期，重新获取后重试一次
    if (res.status === 401) {
      console.warn('[UqPay] Token 过期，重新获取...');
      this._token = null;
      this._tokenExpiredAt = null;
      const newToken = await this.ensureToken();
      headers['x-auth-token'] = newToken;
      const retryRes = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!retryRes.ok) {
        const err = await retryRes.text();
        throw new Error(`[UqPay] 请求失败: ${retryRes.status} ${err}`);
      }
      return retryRes.json() as T;
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[UqPay] 请求失败: ${res.status} ${err}`);
    }

    return res.json() as T;
  }

  // ── 持卡人 (Cardholder) ──────────────────────────────────────────────────

  /**
   * 根据邮箱查找已有持卡人
   */
  async findCardholderByEmail(email: string): Promise<UqPayCardholder | null> {
    // UQPay cardholder list API 不支持按 email 筛选，
    // 采用列表遍历策略（生产环境建议自行维护映射表）
    const pageSize = 50;
    for (let page = 1; page <= 10; page++) {
      const res = await this.request<{ data: UqPayCardholder[] }>(
        'GET',
        `/api/v1/issuing/cardholders?page_size=${pageSize}&page_number=${page}`
      );
      const holders = res.data || [];
      const found = holders.find(h => h.email?.toLowerCase() === email.toLowerCase());
      if (found) return found;
      if (holders.length < pageSize) break;
    }
    return null;
  }

  /**
   * 创建持卡人（幂等，已存在则返回现有）
   */
  async getOrCreateCardholder(params: {
    email: string;
    firstName: string;
    lastName: string;
    countryCode: string;
    phoneNumber: string;
    dateOfBirth?: string;
    nationality?: string;
    gender?: 'MALE' | 'FEMALE';
  }): Promise<UqPayCardholder> {
    // 先查缓存
    if (this._cachedCardholderId) {
      return this.getCardholder(this._cachedCardholderId);
    }

    // 再查列表
    const existing = await this.findCardholderByEmail(params.email);
    if (existing) {
      this._cachedCardholderId = existing.id;
      return existing;
    }

    // 创建新持卡人
    const created = await this.request<UqPayCardholder>('POST', '/api/v1/issuing/cardholders', {
      email: params.email,
      first_name: params.firstName,
      last_name: params.lastName,
      country_code: params.countryCode,
      phone_number: params.phoneNumber,
      ...(params.dateOfBirth && { date_of_birth: params.dateOfBirth }),
      ...(params.nationality && { nationality: params.nationality }),
      ...(params.gender && { gender: params.gender }),
    });

    this._cachedCardholderId = created.id;
    console.log('[UqPay] 持卡人创建成功:', created.id);
    return created;
  }

  /**
   * 获取持卡人详情
   */
  async getCardholder(cardholderId: string): Promise<UqPayCardholder> {
    return this.request<UqPayCardholder>('GET', `/api/v1/issuing/cardholders/${cardholderId}`);
  }

  // ── 卡产品 (Card Products) ───────────────────────────────────────────────

  /**
   * 列出可用卡产品
   */
  async listCardProducts(): Promise<UqPayCardProduct[]> {
    const res = await this.request<{ data: UqPayCardProduct[] }>(
      'GET',
      '/api/v1/issuing/products?page_size=100&page_number=1'
    );
    return res.data || [];
  }

  /**
   * 根据币种获取第一个可用卡产品ID（缓存）
   */
  async getCardProductId(currency: string = 'USD'): Promise<string> {
    const products = await this.listCardProducts();
    const product = products.find(
      p => p.currency.toUpperCase() === currency.toUpperCase() && p.status === 'ACTIVE'
    );
    if (!product) {
      throw new Error(`[UqPay] 未找到 ${currency} 可用卡产品，请确认 UQPay 账户已开通该币种发卡权限`);
    }
    console.log('[UqPay] 卡产品:', product.id, product.name);
    return product.id;
  }

  // ── 卡片 (Cards) ─────────────────────────────────────────────────────────

  /**
   * 创建虚拟卡/实体卡
   */
  async createCard(params: {
    cardholderId: string;
    cardProductId: string;
    cardCurrency?: string;
    cardLimit?: number;
    cardType?: 'virtual' | 'physical';
    usageType?: 'NORMAL' | 'ONE_TIME';
    autoCancelTrigger?: 'ON_AUTH' | 'ON_CAPTURE';
    metadata?: Record<string, string>;
  }): Promise<{
    id: string;
    last4: string;
    expiryMonth: string;
    expiryYear: string;
    status: string;
    cardNumber?: string;
    cvv?: string;
    createdAt: string;
  }> {
    const card = await this.request<UqPayCard>('POST', '/api/v1/issuing/cards', {
      cardholder_id: params.cardholderId,
      card_product_id: params.cardProductId,
      card_currency: params.cardCurrency || 'USD',
      card_limit: params.cardLimit ?? 0,
      usage_type: params.usageType || 'NORMAL',
      ...(params.autoCancelTrigger && { auto_cancel_trigger: params.autoCancelTrigger }),
      ...(params.metadata && { metadata: params.metadata }),
    });

    // 注意: UQPay 创建卡响应中 card_number / cvv 可能为空（安全原因），
    // 完整卡面信息需从 UQPay Dashboard 或 webhook 获取
    return {
      id: card.id,
      last4: card.last4,
      expiryMonth: card.expiry_month,
      expiryYear: card.expiry_year,
      status: card.status,
      cardNumber: (card as any).card_number || undefined,
      cvv: (card as any).cvv || undefined,
      createdAt: card.created_at,
    };
  }

  /**
   * 获取卡片详情
   */
  async getCard(cardId: string): Promise<UqPayCard> {
    return this.request<UqPayCard>('GET', `/api/v1/issuing/cards/${cardId}`);
  }

  /**
   * 更新卡片状态
   */
  async updateCardStatus(
    cardId: string,
    status: 'ACTIVE' | 'FROZEN' | 'CANCELLED' | 'BLOCKED' | 'LOST' | 'STOLEN'
  ): Promise<UqPayCard> {
    return this.request<UqPayCard>('POST', `/api/v1/issuing/cards/${cardId}`, {
      card_status: status,
    });
  }

  /**
   * 冻结卡片
   */
  async freezeCard(cardId: string): Promise<void> {
    await this.updateCardStatus(cardId, 'FROZEN');
    console.log('[UqPay] 卡片已冻结:', cardId);
  }

  /**
   * 解冻卡片（恢复为 ACTIVE）
   */
  async unfreezeCard(cardId: string): Promise<void> {
    await this.updateCardStatus(cardId, 'ACTIVE');
    console.log('[UqPay] 卡片已解冻:', cardId);
  }

  /**
   * 取消卡片
   */
  async cancelCard(cardId: string): Promise<void> {
    await this.updateCardStatus(cardId, 'CANCELLED');
    console.log('[UqPay] 卡片已取消:', cardId);
  }

  /**
   * 挂失卡片
   */
  async reportLostCard(cardId: string): Promise<void> {
    await this.updateCardStatus(cardId, 'LOST');
    console.log('[UqPay] 卡片已挂失:', cardId);
  }

  /**
   * 列出当前账户下的所有卡片
   */
  async listCards(params?: {
    cardholderId?: string;
    cardStatus?: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<UqPayCard[]> {
    const pageSize = params?.pageSize ?? 50;
    const pageNumber = params?.pageNumber ?? 1;
    let url = `/api/v1/issuing/cards?page_size=${pageSize}&page_number=${pageNumber}`;
    if (params?.cardholderId) url += `&cardholder_id=${params.cardholderId}`;
    if (params?.cardStatus) url += `&card_status=${params.cardStatus}`;

    const res = await this.request<{ data: UqPayCard[] }>('GET', url);
    return res.data || [];
  }

  // ── 钱包充值 (Wallet / Transfer) ─────────────────────────────────────────

  /**
   * 获取 UQPay 平台的加密货币充值地址
   *
   * UQPay 发卡账户充值有两种方式:
   * 1. 加密货币转账: 将 USDT 充值到平台在 UQPay 的钱包地址，
   *    然后通过 Transfer API 转入发卡账户
   * 2. 直接充值: 如果 UQPay 支持 C2C 充值订单，通过此方法获取支付地址
   *
   * 返回: { address, chain, qrCode? }
   */
  async getDepositAddress(chain: string = 'trx'): Promise<{
    address: string;
    chain: string;
    qrCode?: string;
  }> {
    // UQPay 文档中暂无独立的虚拟货币地址 API，
    // 此处返回平台配置的默认充值地址（从 channel config_json 中读取）
    // 生产环境可扩展为调用 UQPay 专用的钱包地址接口
    throw new Error(
      '[UqPay] getDepositAddress 需要平台配置充值地址。' +
      '请在 card_channels.config_json 中配置 deposit_addresses 对象。' +
      '示例: {"trx": "TRC20地址", "eth": "ERC20地址", "bnb": "BEP20地址"}'
    );
  }

  /**
   * 创建 C2C 充值订单
   *
   * UQPay 模式下，充值流程为:
   * 1. 用户向平台 UQPay 钱包地址转账 USDT
   * 2. 平台监听链上到账，确认后通过 Transfer API 转入发卡账户
   * 3. 此方法创建订单记录并返回支付地址
   *
   * 返回: { orderId, payAddress, amount, token, network, expireAt }
   */
  async createC2COrder(params: {
    amount: number;
    token?: string;
    network?: string;
    userId?: string;
  }): Promise<{
    orderId: string;
    payAddress: string;
    amount: number;
    token: string;
    network: string;
    expireAt: string;
  }> {
    // 获取充值地址（需平台在 config_json 中配置）
    const chainMap: Record<string, string> = {
      trx: 'TRC20',
      eth: 'ERC20',
      bnb: 'BEP20',
    };
    const chain = params.network || 'trx';
    const chainName = chainMap[chain] || 'TRC20';

    // 从 SDK 内部配置的平台充值地址读取（可在实例化时注入）
    const depositAddress = (this as any)._platformDepositAddresses?.[chain];
    if (!depositAddress) {
      throw new Error(
        `[UqPay] 平台未配置 ${chainName} 充值地址。` +
        `请在 card_channels.config_json 中配置 deposit_addresses.${chain}`
      );
    }

    const orderId = `UQ${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const expireAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    return {
      orderId,
      payAddress: depositAddress,
      amount: params.amount,
      token: params.token || 'USDT',
      network: chainName,
      expireAt,
    };
  }

  /**
   * 从平台钱包向发卡账户转账（充值确认后调用）
   *
   * @param sourceAccountId 源账户（平台 UQPay 账户）
   * @param targetAccountId 目标账户（持卡人发卡账户）
   * @param amount 金额
   * @param currency 币种
   */
  async transferToCard(
    sourceAccountId: string,
    targetAccountId: string,
    amount: number,
    currency: string = 'USD'
  ): Promise<UqPayTransfer> {
    return this.request<UqPayTransfer>('POST', '/api/v1/transfer', {
      source_account_id: sourceAccountId,
      target_account_id: targetAccountId,
      currency,
      amount: String(amount),
      reason: 'Card wallet top-up',
    });
  }

  /**
   * 获取 UQPay 账户列表（用于获取 platform account_id）
   */
  async listAccounts(): Promise<Array<{ account_id: string; name: string; currency: string }>> {
    const res = await this.request<{ data: Array<{ account_id: string; name: string; currency: string }> }>(
      'GET',
      '/api/v1/accounts?page_size=100&page_number=1'
    );
    return res.data || [];
  }

  // ── Secure iFrame / PAN Token ────────────────────────────────────────────

  /**
   * 为指定卡片生成一次性 PAN Token，用于 Secure iFrame 安全展示卡面信息
   *
   * API: POST /api/v1/issuing/cards/{card_id}/token
   * 文档: https://docs.uqpay.com/docs/secure-iframe-guide
   *
   * Token 有效期 60 秒，仅可使用一次
   */
  async getPanToken(cardId: string): Promise<{
    token: string;
    expiresIn: number;
    expiresAt: string;
  }> {
    const res = await this.request<{ token: string; expires_in: number; expires_at: string }>(
      'POST',
      `/api/v1/issuing/cards/${cardId}/token`
    );
    return {
      token: res.token,
      expiresIn: res.expires_in,
      expiresAt: res.expires_at,
    };
  }

  /**
   * 构建 Secure iFrame URL
   *
   * 域名:
   *   Sandbox: https://embedded-sandbox.uqpaytech.com
   *   Production: https://embedded.uqpay.com
   *
   * URL 格式: {iframe_domain}/iframe/card?token={pan_token}&cardId={card_id}&lang={lang}
   */
  buildSecureIframeUrl(panToken: string, cardId: string, lang: string = 'zh'): string {
    const iframeDomain = this.baseUrl.includes('sandbox')
      ? 'https://embedded-sandbox.uqpaytech.com'
      : 'https://embedded.uqpay.com';
    return `${iframeDomain}/iframe/card?token=${panToken}&cardId=${cardId}&lang=${lang}`;
  }

  // ── 工具方法 ─────────────────────────────────────────────────────────────

  /**
   * 诊断接口: 检查 SDK 配置是否正确
   */
  async diagnose(): Promise<{
    tokenOk: boolean;
    cardholderCount: number;
    cardProductCount: number;
    accounts: number;
    error?: string;
  }> {
    try {
      const token = await this.refreshToken();
      const [holders, products, accounts] = await Promise.all([
        this.request<{ data: UqPayCardholder[] }>('GET', '/api/v1/issuing/cardholders?page_size=1&page_number=1'),
        this.request<{ data: UqPayCardProduct[] }>('GET', '/api/v1/issuing/products?page_size=1&page_number=1'),
        this.request<{ data: any[] }>('GET', '/api/v1/accounts?page_size=1&page_number=1'),
      ]);
      return {
        tokenOk: !!token,
        cardholderCount: holders.data?.length ?? 0,
        cardProductCount: products.data?.length ?? 0,
        accounts: accounts.data?.length ?? 0,
      };
    } catch (err: any) {
      return { tokenOk: false, cardholderCount: 0, cardProductCount: 0, accounts: 0, error: err.message };
    }
  }
}

export default UqPaySDK;
