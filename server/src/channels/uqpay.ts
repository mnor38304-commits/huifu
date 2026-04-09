/**
 * UQPay Issuing API SDK
 * 鏂囨。: https://docs.uqpay.com
 *
 * Base URL:
 *   Sandbox: https://api-sandbox.uqpaytech.com
 *   Production: https://api.uqpaytech.com
 *
 * 璁よ瘉鏂瑰紡:
 *   1. POST /api/v1/connect/token 鈫?鑾峰彇 auth_token (x-auth-token header)
 *   2. 鍚庣画鎵€鏈夎姹傚湪 header 涓紶 x-auth-token
 */

import { randomUUID } from 'crypto';

// 鈹€鈹€鈹€ Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface UqPayConfig {
  clientId: string;
  apiKey: string;
  /** 榛樿 sandbox锛岀敓浜х幆澧冩浛鎹?*/
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
  card_number?: string; // 鏄庢枃鍗″彿浠呭湪鍒涘缓鏃惰繑鍥炰竴娆★紝鍚庣画闇€浠庢笭閬撳钩鍙拌幏鍙?
  cvv?: string;          // 鍚屼笂
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

// 鈹€鈹€鈹€ SDK 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export class UqPaySDK {
  private clientId: string;
  private apiKey: string;
  private baseUrl: string;
  private _token: string | null = null;
  private _tokenExpiredAt: Date | null = null;

  // cardholder 缂撳瓨锛堝钩鍙板唴鍙垱寤轰竴娆★紝閬垮厤閲嶅锛?
  private _cachedCardholderId: string | null = null;

  constructor(config: UqPayConfig) {
    this.clientId = config.clientId;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api-sandbox.uqpaytech.com';
  }

  // 鈹€鈹€ Private: Token 绠＄悊 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  private async ensureToken(): Promise<string> {
    // token 鍓╀綑 5 鍒嗛挓鍐呮彁鍓嶅埛鏂?
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
      throw new Error(`[UqPay] Token 鍒锋柊澶辫触: ${res.status} ${body}`);
    }

    const data: UqPayToken = await res.json() as UqPayToken;
    this._token = data.auth_token;
    this._tokenExpiredAt = new Date(data.expired_at);
    console.log('[UqPay] Token 鍒锋柊鎴愬姛锛屾湁鏁堣嚦:', data.expired_at);
    return this._token;
  }

  // 鈹€鈹€ Private: 閫氱敤璇锋眰 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

    // 401 鈫?token 杩囨湡锛岄噸鏂拌幏鍙栧悗閲嶈瘯涓€娆?
    if (res.status === 401) {
      console.warn('[UqPay] Token 杩囨湡锛岄噸鏂拌幏鍙?..');
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
        throw new Error(`[UqPay] 璇锋眰澶辫触: ${retryRes.status} ${err}`);
      }
      return retryRes.json() as T;
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[UqPay] 璇锋眰澶辫触: ${res.status} ${err}`);
    }

    return res.json() as T;
  }

  // 鈹€鈹€ 鎸佸崱浜?(Cardholder) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  /**
   * 鏍规嵁閭鏌ユ壘宸叉湁鎸佸崱浜?
   */
  async findCardholderByEmail(email: string): Promise<UqPayCardholder | null> {
    // UQPay cardholder list API 涓嶆敮鎸佹寜 email 绛涢€夛紝
    // 閲囩敤鍒楄〃閬嶅巻绛栫暐锛堢敓浜х幆澧冨缓璁嚜琛岀淮鎶ゆ槧灏勮〃锛?
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
   * 鍒涘缓鎸佸崱浜猴紙骞傜瓑锛屽凡瀛樺湪鍒欒繑鍥炵幇鏈夛級
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
    // 鍏堟煡缂撳瓨
    if (this._cachedCardholderId) {
      return this.getCardholder(this._cachedCardholderId);
    }

    // 鍐嶆煡鍒楄〃
    const existing = await this.findCardholderByEmail(params.email);
    if (existing) {
      this._cachedCardholderId = existing.id;
      return existing;
    }

    // 鍒涘缓鏂版寔鍗′汉
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
    console.log('[UqPay] 鎸佸崱浜哄垱寤烘垚鍔?', created.id);
    return created;
  }

  /**
   * 鑾峰彇鎸佸崱浜鸿鎯?
   */
  async getCardholder(cardholderId: string): Promise<UqPayCardholder> {
    return this.request<UqPayCardholder>('GET', `/api/v1/issuing/cardholders/${cardholderId}`);
  }

  // 鈹€鈹€ 鍗′骇鍝?(Card Products) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  /**
   * 鍒楀嚭鍙敤鍗′骇鍝?
   */
  async listCardProducts(): Promise<UqPayCardProduct[]> {
    const res = await this.request<{ data: UqPayCardProduct[] }>(
      'GET',
      '/api/v1/issuing/products?page_size=100&page_number=1'
    );
    return res.data || [];
  }

  /**
   * 鏍规嵁甯佺鑾峰彇绗竴涓彲鐢ㄥ崱浜у搧ID锛堢紦瀛橈級
   */
  async getCardProductId(currency: string = 'USD'): Promise<string> {
    const products = await this.listCardProducts();
    const product = products.find(
      p => p.currency.toUpperCase() === currency.toUpperCase() && p.status === 'ACTIVE'
    );
    if (!product) {
      throw new Error(`[UqPay] 鏈壘鍒?${currency} 鍙敤鍗′骇鍝侊紝璇风‘璁?UQPay 璐︽埛宸插紑閫氳甯佺鍙戝崱鏉冮檺`);
    }
    console.log('[UqPay] 鍗′骇鍝?', product.id, product.name);
    return product.id;
  }

  // 鈹€鈹€ 鍗＄墖 (Cards) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  /**
   * 鍒涘缓铏氭嫙鍗?瀹炰綋鍗?
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

    // 娉ㄦ剰: UQPay 鍒涘缓鍗″搷搴斾腑 card_number / cvv 鍙兘涓虹┖锛堝畨鍏ㄥ師鍥狅級锛?
    // 瀹屾暣鍗￠潰淇℃伅闇€浠?UQPay Dashboard 鎴?webhook 鑾峰彇
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
   * 鑾峰彇鍗＄墖璇︽儏
   */
  async getCard(cardId: string): Promise<UqPayCard> {
    return this.request<UqPayCard>('GET', `/api/v1/issuing/cards/${cardId}`);
  }

  /**
   * 鏇存柊鍗＄墖鐘舵€?
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
   * 鍐荤粨鍗＄墖
   */
  async freezeCard(cardId: string): Promise<void> {
    await this.updateCardStatus(cardId, 'FROZEN');
    console.log('[UqPay] 鍗＄墖宸插喕缁?', cardId);
  }

  /**
   * 瑙ｅ喕鍗＄墖锛堟仮澶嶄负 ACTIVE锛?
   */
  async unfreezeCard(cardId: string): Promise<void> {
    await this.updateCardStatus(cardId, 'ACTIVE');
    console.log('[UqPay] 鍗＄墖宸茶В鍐?', cardId);
  }

  /**
   * 鍙栨秷鍗＄墖
   */
  async cancelCard(cardId: string): Promise<void> {
    await this.updateCardStatus(cardId, 'CANCELLED');
    console.log('[UqPay] 鍗＄墖宸插彇娑?', cardId);
  }

  /**
   * 鎸傚け鍗＄墖
   */
  async reportLostCard(cardId: string): Promise<void> {
    await this.updateCardStatus(cardId, 'LOST');
    console.log('[UqPay] 鍗＄墖宸叉寕澶?', cardId);
  }

  /**
   * 鍒楀嚭褰撳墠璐︽埛涓嬬殑鎵€鏈夊崱鐗?
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

  // 鈹€鈹€ 閽卞寘鍏呭€?(Wallet / Transfer) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  /**
   * 鑾峰彇 UQPay 骞冲彴鐨勫姞瀵嗚揣甯佸厖鍊煎湴鍧€
   *
   * UQPay 鍙戝崱璐︽埛鍏呭€兼湁涓ょ鏂瑰紡:
   * 1. 鍔犲瘑璐у竵杞处: 灏?USDT 鍏呭€煎埌骞冲彴鍦?UQPay 鐨勯挶鍖呭湴鍧€锛?
   *    鐒跺悗閫氳繃 Transfer API 杞叆鍙戝崱璐︽埛
   * 2. 鐩存帴鍏呭€? 濡傛灉 UQPay 鏀寔 C2C 鍏呭€艰鍗曪紝閫氳繃姝ゆ柟娉曡幏鍙栨敮浠樺湴鍧€
   *
   * 杩斿洖: { address, chain, qrCode? }
   */
  async getDepositAddress(chain: string = 'trx'): Promise<{
    address: string;
    chain: string;
    qrCode?: string;
  }> {
    // UQPay 鏂囨。涓殏鏃犵嫭绔嬬殑铏氭嫙璐у竵鍦板潃 API锛?
    // 姝ゅ杩斿洖骞冲彴閰嶇疆鐨勯粯璁ゅ厖鍊煎湴鍧€锛堜粠 channel config_json 涓鍙栵級
    // 鐢熶骇鐜鍙墿灞曚负璋冪敤 UQPay 涓撶敤鐨勯挶鍖呭湴鍧€鎺ュ彛
    throw new Error(
      '[UqPay] getDepositAddress 闇€瑕佸钩鍙伴厤缃厖鍊煎湴鍧€銆? +
      '璇峰湪 card_channels.config_json 涓厤缃?deposit_addresses 瀵硅薄銆? +
      '绀轰緥: {"trx": "TRC20鍦板潃", "eth": "ERC20鍦板潃", "bnb": "BEP20鍦板潃"}'
    );
  }

  /**
   * 鍒涘缓 C2C 鍏呭€艰鍗?
   *
   * UQPay 妯″紡涓嬶紝鍏呭€兼祦绋嬩负:
   * 1. 鐢ㄦ埛鍚戝钩鍙?UQPay 閽卞寘鍦板潃杞处 USDT
   * 2. 骞冲彴鐩戝惉閾句笂鍒拌处锛岀‘璁ゅ悗閫氳繃 Transfer API 杞叆鍙戝崱璐︽埛
   * 3. 姝ゆ柟娉曞垱寤鸿鍗曡褰曞苟杩斿洖鏀粯鍦板潃
   *
   * 杩斿洖: { orderId, payAddress, amount, token, network, expireAt }
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
    // 鑾峰彇鍏呭€煎湴鍧€锛堥渶骞冲彴鍦?config_json 涓厤缃級
    const chainMap: Record<string, string> = {
      trx: 'TRC20',
      eth: 'ERC20',
      bnb: 'BEP20',
    };
    const chain = params.network || 'trx';
    const chainName = chainMap[chain] || 'TRC20';

    // 浠?SDK 鍐呴儴閰嶇疆鐨勫钩鍙板厖鍊煎湴鍧€璇诲彇锛堝彲鍦ㄥ疄渚嬪寲鏃舵敞鍏ワ級
    const depositAddress = (this as any)._platformDepositAddresses?.[chain];
    if (!depositAddress) {
      throw new Error(
        `[UqPay] 骞冲彴鏈厤缃?${chainName} 鍏呭€煎湴鍧€銆俙 +
        `璇峰湪 card_channels.config_json 涓厤缃?deposit_addresses.${chain}`
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
   * 浠庡钩鍙伴挶鍖呭悜鍙戝崱璐︽埛杞处锛堝厖鍊肩‘璁ゅ悗璋冪敤锛?
   *
   * @param sourceAccountId 婧愯处鎴凤紙骞冲彴 UQPay 璐︽埛锛?
   * @param targetAccountId 鐩爣璐︽埛锛堟寔鍗′汉鍙戝崱璐︽埛锛?
   * @param amount 閲戦
   * @param currency 甯佺
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
   * 鑾峰彇 UQPay 璐︽埛鍒楄〃锛堢敤浜庤幏鍙?platform account_id锛?
   */
  async listAccounts(): Promise<Array<{ account_id: string; name: string; currency: string }>> {
    const res = await this.request<{ data: Array<{ account_id: string; name: string; currency: string }> }>(
      'GET',
      '/api/v1/accounts?page_size=100&page_number=1'
    );
    return res.data || [];
  }

  // 鈹€鈹€ 宸ュ叿鏂规硶 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  /**
   * 璇婃柇鎺ュ彛: 妫€鏌?SDK 閰嶇疆鏄惁姝ｇ‘
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
