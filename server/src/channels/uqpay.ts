/**
 * UQPay Issuing API SDK
 * 文档: https://docs.uqpay.com
 *
 * Base URL:
 *   Sandbox: https://api-sandbox.uqpaytech.com
 *   Production: https://api.uqpay.com
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
  /** UQPay POST 创建返回 cardholder_id（GET 详情返回 id） */
  cardholder_id?: string;
  email: string;
  first_name: string;
  last_name: string;
  country_code: string;
  phone_number: string;
  status: 'PENDING' | 'SUCCESS' | 'INCOMPLETE' | 'FAILED';
  /** UQPay POST 创建返回 cardholder_status（GET 详情返回 status） */
  cardholder_status?: string;
  created_at: string;
  updated_at: string;
}

/**
 * UQPay Card Product — 标准化接口
 *
 * UQPay API 实际返回字段可能与接口不同（如 product_id vs id、数组 vs 字符串），
 * listCardProducts() 内部负责将原始响应标准化为此接口。
 */
export interface UqPayCardProduct {
  /** 产品唯一 ID（UQPay 实际返回 product_id，兼容 id） */
  product_id: string;
  /** 产品名称（可选，部分渠道不返回） */
  name?: string;
  /** 卡 BIN 码（如 40963608） */
  card_bin: string;
  /** 支持币种数组（如 ["USD"]） */
  card_currency: string[];
  /** 卡形式数组（如 ["VIR","PHY"]） */
  card_form: string[];
  /** 卡组织（如 VISA / MC） */
  card_scheme: string;
  /** 模式：SHARE（共享额度）或 SINGLE（独立额度） */
  mode_type: 'SHARE' | 'SINGLE';
  /** 产品状态：ENABLED / ACTIVE / DISABLED 等 */
  product_status: string;
  /** KYC 等级（如 SIMPLIFIED） */
  kyc_level?: string;
  /** 最大发卡配额 */
  max_card_quota?: number;
  /** 创建时必填字段列表 */
  required_fields?: Array<{ name: string; type: string; required: boolean }>;
}

/**
 * UQPay Card 详情 — 标准化接口
 *
 * UQPay API 实际返回字段可能不同（如 card_id vs id、card_status vs status），
 * createCard() 和 getCard() 内部负责将原始响应标准化为此接口。
 */
export interface UqPayCard {
  /** 卡片 ID（UQPay 实际返回 card_id，兼容 id） */
  card_id: string;
  /** 卡订单 ID（创建时返回） */
  card_order_id?: string;
  cardholder_id: string;
  card_product_id: string;
  last4: string;
  expiry_month: string;
  expiry_year: string;
  /** 卡状态（UQPay 实际返回 card_status，兼容 status） */
  card_status: string;
  /** 订单状态（创建时返回：PROCESSING / COMPLETED 等） */
  order_status?: string;
  currency: string;
  card_limit: number;
  card_available_balance?: number;
  /** 创建时间（UQPay 实际返回 create_time，兼容 created_at） */
  create_time: string;
  updated_at: string;
  /** 明文卡号仅在创建时返回一次，后续需从渠道平台获取 */
  card_number?: string;
  /** 同上 */
  cvv?: string;
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

/**
 * UQPay 卡充值响应 — 标准化接口
 *
 * API: POST /api/v1/issuing/cards/{cardId}/recharge
 * 文档: https://docs.uqpay.com/reference/card-recharge
 * Go SDK 类型: CardOrder (cards.go)
 *
 * 安全约束:
 * - 不使用 card_number / PAN
 * - 不使用 PAN Token 作为充值参数
 * - 不保存 CVV
 *
 * 响应字段（标准化，对齐 Go SDK CardOrder）：
 *   card_id                 - 卡 ID
 *   card_order_id           - 卡订单 ID（UQPay 充值订单号）
 *   order_type              - 订单类型（RECHARGE）
 *   amount                  - 充值金额
 *   card_currency           - 币种（如 USD）
 *   order_status            - 充值状态：PENDING / SUCCESS / FAILED
 *   create_time             - 创建时间
 *   update_time             - 更新时间
 *   complete_time           - 完成时间
 *   balance_after           - 充值后余额（卡账户层面）
 *   card_available_balance  - 可用余额
 *   balance_id              - 余额账户 ID（可选，API 可能返回）
 *   raw_json                - 原始响应（脱敏，不含 PAN/CVV/token）
 *
 * 兼容旧字段映射：
 *   recharge_amount  → amount
 *   recharge_status  → order_status
 *   recharge_time    → create_time / complete_time
 */
export interface UqPayRechargeResponse {
  card_id: string;
  card_order_id?: string;
  order_type?: string;
  amount: number;
  card_currency?: string;
  order_status: 'PENDING' | 'SUCCESS' | 'FAILED';
  create_time?: string;
  update_time?: string;
  complete_time?: string;
  balance_after?: number;
  card_available_balance?: number;
  balance_id?: string;
  raw_json: any;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * 将 UQPay Card Product 原始响应标准化为 UqPayCardProduct 接口
 *
 * 兼容字段映射：
 * - product_id / id → product_id
 * - card_currency (数组或字符串) → card_currency (数组)
 * - card_form (数组或字符串) → card_form (数组)
 * - card_scheme / card_network → card_scheme
 * - product_status / status → product_status
 */
function normalizeCardProduct(raw: any): UqPayCardProduct {
  // card_currency: 兼容数组或字符串
  const card_currency = Array.isArray(raw.card_currency)
    ? raw.card_currency.map(String)
    : raw.currency
      ? [String(raw.currency)]
      : ['USD'];

  // card_form: 兼容数组或字符串
  const card_form = Array.isArray(raw.card_form)
    ? raw.card_form.map(String)
    : raw.card_type
      ? [String(raw.card_type)]
      : ['VIR'];

  return {
    product_id: String(raw.product_id || raw.id || ''),
    name: raw.name || undefined,
    card_bin: String(raw.card_bin || ''),
    card_currency,
    card_form,
    card_scheme: String(raw.card_scheme || raw.card_network || 'VISA'),
    mode_type: (String(raw.mode_type || 'SHARE').toUpperCase() === 'SINGLE' ? 'SINGLE' : 'SHARE') as 'SHARE' | 'SINGLE',
    product_status: String(raw.product_status || raw.status || 'UNKNOWN'),
    kyc_level: raw.kyc_level || undefined,
    max_card_quota: raw.max_card_quota != null ? Number(raw.max_card_quota) : undefined,
    required_fields: Array.isArray(raw.required_fields) ? raw.required_fields : undefined,
  };
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
   * 确保 uqpay_cardholders 本地缓存表存在
   * 注意: database 参数是 sql.js 原生 Database 对象，使用原生 API
   */
  private _tableEnsured = false;

  private ensureCardholderTable(database: any): void {
    if (this._tableEnsured) return;
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS uqpay_cardholders (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id            INTEGER NOT NULL,
          uqpay_cardholder_id TEXT NOT NULL,
          email              TEXT,
          phone_number       TEXT,
          cardholder_status  TEXT,
          raw_json           TEXT,
          created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id),
          UNIQUE(uqpay_cardholder_id)
        )
      `);
      try { database.run('CREATE INDEX IF NOT EXISTS idx_uqpay_ch_email ON uqpay_cardholders(email)'); } catch (_) {}
      this._tableEnsured = true;
    } catch (e) {
      console.warn('[UqPay] 创建 uqpay_cardholders 表失败:', e);
    }
  }

  /**
   * 从本地缓存查询 user_id 对应的 cardholder
   * 使用 sql.js 原生 prepared statement API
   */
  private getLocalCardholder(database: any, userId: number): UqPayCardholder | null {
    this.ensureCardholderTable(database);
    try {
      const stmt = database.prepare('SELECT * FROM uqpay_cardholders WHERE user_id = ?');
      stmt.bind([userId]);
      if (!stmt.step()) { stmt.free(); return null; }
      const cols = stmt.getColumnNames();
      const vals = stmt.get();
      stmt.free();
      const row: any = {};
      cols.forEach((c: string, i: number) => { row[c] = vals[i]; });
      return {
        id: row.uqpay_cardholder_id || '',
        cardholder_id: row.uqpay_cardholder_id || '',
        email: row.email || '',
        first_name: '',
        last_name: '',
        country_code: '',
        phone_number: row.phone_number || '',
        status: (row.cardholder_status || 'SUCCESS') as UqPayCardholder['status'],
        cardholder_status: row.cardholder_status || '',
        created_at: row.created_at || '',
        updated_at: row.updated_at || '',
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 创建持卡人（幂等，已存在则返回现有）
   *
   * 查找顺序：
   * 1. 内存缓存 (_cachedCardholderId)
   * 2. 本地缓存表 (uqpay_cardholders by userId)
   * 3. UQPay API 列表遍历 (findCardholderByEmail)
   * 4. 调用 UQPay 创建
   */
  async getOrCreateCardholder(params: {
    userId?: number;
    email: string;
    firstName: string;
    lastName: string;
    countryCode: string;
    phoneNumber: string;
    dateOfBirth?: string;
    nationality?: string;
    gender?: 'MALE' | 'FEMALE';
    /** sql.js 数据库实例，用于本地缓存读写 */
    database?: any;
  }): Promise<UqPayCardholder> {
    // 1. 内存缓存
    if (this._cachedCardholderId) {
      return this.getCardholder(this._cachedCardholderId);
    }

    // 2. 本地缓存表
    if (params.userId && params.database) {
      const local = this.getLocalCardholder(params.database, params.userId);
      if (local) {
        this._cachedCardholderId = local.id;
        console.log('[UqPay] 从本地缓存获取持卡人:', local.id.slice(0, 8) + '...', 'user_id:', params.userId);
        return local;
      }
    }

    // 3. UQPay API 列表查找
    const existing = await this.findCardholderByEmail(params.email);
    if (existing) {
      this._cachedCardholderId = existing.id;
      // 回写本地缓存（如果提供了 userId 和 database）
      if (params.userId && params.database) {
        this.saveCardholderToLocal(params.database, params.userId, existing);
      }
      return existing;
    }

    // 4. 创建新持卡人
    let created: any;
    try {
      created = await this.request<any>('POST', '/api/v1/issuing/cardholders', {
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        country_code: params.countryCode,
        phone_number: params.phoneNumber,
        ...(params.dateOfBirth && { date_of_birth: params.dateOfBirth }),
        ...(params.nationality && { nationality: params.nationality }),
        ...(params.gender && { gender: params.gender }),
      });
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('email_duplicated') || msg.includes('duplicate')) {
        // email 重复 — 尝试从列表获取已有 cardholder
        console.warn('[UqPay] cardholder email 已存在，尝试从列表获取:', params.email);
        const dup = await this.findCardholderByEmail(params.email);
        if (dup) {
          this._cachedCardholderId = dup.id;
          if (params.userId && params.database) {
            this.saveCardholderToLocal(params.database, params.userId, dup);
          }
          return dup;
        }
      }
      if (msg.includes('invalid_phone_number') || msg.includes('phone')) {
        console.error('[UqPay] cardholder 创建失败：手机号格式错误');
      }
      throw err;
    }

    // UQPay POST 返回 cardholder_id（GET 返回 id），兼容两种
    const cardholderId = created.cardholder_id || created.id;
    if (!cardholderId) {
      throw new Error('[UqPay] 创建持卡人成功但未返回 cardholder_id，响应: ' + JSON.stringify(created).slice(0, 200));
    }

    // 标准化为 GET 返回格式
    const normalized: UqPayCardholder = {
      id: cardholderId,
      cardholder_id: cardholderId,
      email: created.email || params.email,
      first_name: created.first_name || params.firstName,
      last_name: created.last_name || params.lastName,
      country_code: created.country_code || params.countryCode,
      phone_number: created.phone_number || params.phoneNumber,
      status: (created.cardholder_status || created.status || 'SUCCESS') as any,
      cardholder_status: created.cardholder_status || created.status,
      created_at: created.created_at || new Date().toISOString(),
      updated_at: created.updated_at || new Date().toISOString(),
    };

    this._cachedCardholderId = cardholderId;
    console.log('[UqPay] 持卡人创建成功:', cardholderId.slice(0, 8) + '...', 'status:', normalized.status);

    // 保存到本地缓存
    if (params.userId && params.database) {
      this.saveCardholderToLocal(params.database, params.userId, normalized);
    }

    return normalized;
  }

  /**
   * 保存 cardholder 到本地缓存表
   */
  private saveCardholderToLocal(database: any, userId: number, ch: UqPayCardholder): void {
    this.ensureCardholderTable(database);
    const id = ch.cardholder_id || ch.id;
    const status = ch.cardholder_status || ch.status || 'SUCCESS';
    const rawJson = JSON.stringify(ch).slice(0, 2000);
    try {
      // 检查是否已存在
      const checkStmt = database.prepare('SELECT id FROM uqpay_cardholders WHERE user_id = ?');
      checkStmt.bind([userId]);
      const exists = checkStmt.step();
      checkStmt.free();

      if (exists) {
        const updateStmt = database.prepare(
          'UPDATE uqpay_cardholders SET uqpay_cardholder_id = ?, email = ?, phone_number = ?, cardholder_status = ?, raw_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?'
        );
        updateStmt.run([id, ch.email, ch.phone_number, status, rawJson, userId]);
        updateStmt.free();
      } else {
        const insertStmt = database.prepare(
          'INSERT INTO uqpay_cardholders (user_id, uqpay_cardholder_id, email, phone_number, cardholder_status, raw_json) VALUES (?, ?, ?, ?, ?, ?)'
        );
        insertStmt.run([userId, id, ch.email, ch.phone_number, status, rawJson]);
        insertStmt.free();
      }
    } catch (e) {
      console.warn('[UqPay] 保存 cardholder 到本地缓存失败:', e);
    }
  }

  /**
   * 获取持卡人详情
   */
  async getCardholder(cardholderId: string): Promise<UqPayCardholder> {
    return this.request<UqPayCardholder>('GET', `/api/v1/issuing/cardholders/${cardholderId}`);
  }

  // ── 卡产品 (Card Products) ───────────────────────────────────────────────

  /**
   * 列出可用卡产品（自动标准化字段）
   *
   * UQPay API 返回的字段名与标准化接口存在差异，此方法负责映射：
   * - product_id / id → product_id
   * - card_currency (数组或字符串) → card_currency (数组)
   * - card_form (数组或字符串) → card_form (数组)
   * - card_scheme / card_network → card_scheme
   * - product_status / status → product_status
   */
  async listCardProducts(): Promise<UqPayCardProduct[]> {
    const res = await this.request<{ data: any[] }>(
      'GET',
      '/api/v1/issuing/products?page_size=10000&page_number=1'
    );
    const raw = res.data || [];
    return raw.map(normalizeCardProduct);
  }

  /**
   * 根据币种获取 SINGLE 模式卡产品
   *
   * 业务约束：只开 SINGLE 卡（独立额度），不开 SHARE 卡（共享额度）。
   *
   * 过滤条件：
   * - card_form 包含 VIR（虚拟卡）
   * - card_currency 包含指定币种
   * - product_status 为 ENABLED 或 ACTIVE
   * - mode_type 严格为 SINGLE
   *
   * @returns 标准化后的 SINGLE 卡产品，可直接用于 createCard 的 card_product_id
   * @throws 如果没有符合条件的 SINGLE 产品，抛出明确错误
   */
  async getCardProductId(currency: string = 'USD'): Promise<UqPayCardProduct> {
    const products = await this.listCardProducts();

    const eligibleStatuses = ['ENABLED', 'ACTIVE'];
    const singleOnly = products.filter(p => {
      const hasVir = p.card_form.some(f => f.toUpperCase() === 'VIR');
      const hasCur = p.card_currency.some(c => c.toUpperCase() === currency.toUpperCase());
      const isActive = eligibleStatuses.some(s => p.product_status.toUpperCase().includes(s));
      const isSingle = p.mode_type === 'SINGLE';
      return hasVir && hasCur && isActive && isSingle;
    });

    if (singleOnly.length === 0) {
      // 收集 SHARE 产品信息用于错误提示（帮助排查）
      const shareProducts = products.filter(p => {
        const hasVir = p.card_form.some(f => f.toUpperCase() === 'VIR');
        const hasCur = p.card_currency.some(c => c.toUpperCase() === currency.toUpperCase());
        const isActive = eligibleStatuses.some(s => p.product_status.toUpperCase().includes(s));
        return hasVir && hasCur && isActive && p.mode_type !== 'SINGLE';
      });
      throw new Error(
        `[UqPay] 未找到可用的 UQPay SINGLE 虚拟卡产品（${currency}）。` +
        `可用虚拟卡产品共 ${singleOnly.length + shareProducts.length} 个，其中 SHARE ${shareProducts.length} 个。` +
        `请联系 UQPay 开通 SINGLE 模式卡产品。`
      );
    }

    const chosen = singleOnly[0];
    console.log(
      '[UqPay] 选择 SINGLE 卡产品:',
      chosen.product_id.slice(0, 8) + '...',
      `BIN:${chosen.card_bin}`,
      `${chosen.card_scheme}`,
      chosen.mode_type,
      `status:${chosen.product_status}`
    );
    return chosen;
  }

  // ── 卡片 (Cards) ─────────────────────────────────────────────────────────

  /**
   * 创建虚拟卡/实体卡
   *
   * UQPay POST /api/v1/issuing/cards 响应字段：
   *   card_id, card_order_id, cardholder_id, card_status, order_status, create_time
   * 注意：PENDING 状态不返回 last4/expiry_month/expiry_year
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
    card_id: string;
    card_order_id: string;
    card_status: string;
    order_status: string;
    last4: string;
    expiryMonth: string;
    expiryYear: string;
    cardNumber?: string;
    cvv?: string;
    createdAt: string;
    rawJson: any;
  }> {
    const raw = await this.request<any>('POST', '/api/v1/issuing/cards', {
      cardholder_id: params.cardholderId,
      card_product_id: params.cardProductId,
      card_currency: params.cardCurrency || 'USD',
      card_limit: params.cardLimit ?? 0,
      usage_type: params.usageType || 'NORMAL',
      ...(params.autoCancelTrigger && { auto_cancel_trigger: params.autoCancelTrigger }),
      ...(params.metadata && { metadata: params.metadata }),
    });

    // 兼容字段映射：card_id / id
    const cardId = raw.card_id || raw.id || '';
    // 兼容字段映射：card_status / status
    const cardStatus = raw.card_status || raw.status || 'UNKNOWN';
    const orderStatus = raw.order_status || 'PROCESSING';
    const cardOrderId = raw.card_order_id || raw.order_id || '';
    // PENDING 状态不返回 last4/expiry
    const last4 = raw.last4 || '';
    const expiryMonth = raw.expiry_month || '';
    const expiryYear = raw.expiry_year || '';
    // 兼容字段映射：create_time / created_at
    const createdAt = raw.create_time || raw.created_at || '';

    if (!cardId) {
      throw new Error('[UqPay] createCard: 未获取到 card_id');
    }

    return {
      card_id: cardId,
      card_order_id: cardOrderId,
      card_status: cardStatus,
      order_status: orderStatus,
      last4,
      expiryMonth,
      expiryYear,
      cardNumber: raw.card_number || undefined,
      cvv: raw.cvv || undefined,
      createdAt,
      rawJson: raw,
    };
  }

  /**
   * 获取卡片详情
   *
   * UQPay GET /api/v1/issuing/cards/:cardId 响应字段：
   *   card_id, card_order_id, cardholder_id, card_status, order_status,
   *   last4, expiry_month, expiry_year, currency, card_limit, card_available_balance,
   *   create_time, updated_at
   *
   * 注意：不返回 card_number / cvv（需通过 PAN Token / Secure iFrame 获取）
   */
  async getCard(cardId: string): Promise<{
    card_id: string;
    card_order_id: string;
    cardholder_id: string;
    card_status: string;
    order_status: string;
    last4: string;
    expiry_month: string;
    expiry_year: string;
    currency: string;
    card_limit: number;
    card_available_balance: number;
    create_time: string;
    updated_at: string;
    rawJson: any;
  }> {
    const raw = await this.request<any>('GET', `/api/v1/issuing/cards/${cardId}`);

    return {
      card_id: raw.card_id || raw.id || cardId,
      card_order_id: raw.card_order_id || raw.order_id || '',
      cardholder_id: raw.cardholder_id || '',
      card_status: raw.card_status || raw.status || 'UNKNOWN',
      order_status: raw.order_status || '',
      last4: raw.last4 || '',
      expiry_month: raw.expiry_month || '',
      expiry_year: raw.expiry_year || '',
      currency: raw.currency || raw.card_currency || 'USD',
      card_limit: Number(raw.card_limit ?? 0),
      card_available_balance: Number(raw.card_available_balance ?? 0),
      create_time: raw.create_time || raw.created_at || '',
      updated_at: raw.updated_at || '',
      rawJson: raw,
    };
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

  /**
   * 为卡片充值（使用 issuing cards/{cardId}/recharge）
   *
   * API: POST /api/v1/issuing/cards/{cardId}/recharge
   *
   * 安全约束:
   * - 不使用 card_number / PAN
   * - 不使用 PAN Token 作为充值参数
   * - 不保存 CVV
   * - 不输出 token / clientId / apiKey
   *
   * @param cardId          卡片 UUID（来自 UQPay，非本地 cards.id）
   * @param amount          充值金额
   * @param idempotencyKey  幂等键（由调用方生成，防止重复充值）
   * @param options.balanceId 可选，指定余额账户 ID（从 listIssuingBalances() 获取 USD balance_id）
   *
   * @returns UqPayRechargeResponse
   *
   * 注意：SDK 方法本身不含业务逻辑，事务/钱包操作由上层 service 处理。
   */
  async rechargeCard(
    cardId: string,
    amount: number,
    idempotencyKey: string,
    options: { balanceId?: string } = {}
  ): Promise<UqPayRechargeResponse> {
    // 构建请求体（不使用 card_number / PAN）
    const body: Record<string, any> = {
      amount: amount,
    };
    // 如果提供了 balance_id（如从 listIssuingBalances 获取的 USD balance_id）则填入
    if (options.balanceId) {
      body.balance_id = options.balanceId;
    }

    // 调用 issuing recharge 接口，使用调用方提供的幂等键覆盖默认 UUID
    const raw = await this.request<any>(
      'POST',
      `/api/v1/issuing/cards/${cardId}/recharge`,
      body,
      { 'x-idempotency-key': idempotencyKey }
    );

    // 标准化响应（对齐 Go SDK CardOrder 字段）
    const cardOrderId = raw.card_order_id || raw.order_id || '';
    const orderStatus = (raw.order_status || raw.status || 'PENDING').toUpperCase();
    return {
      card_id: raw.card_id || raw.id || cardId,
      card_order_id: cardOrderId,
      order_type: raw.order_type || 'RECHARGE',
      amount: Number(raw.amount ?? amount),
      card_currency: raw.card_currency || raw.currency || 'USD',
      order_status: (orderStatus === 'SUCCESS' || orderStatus === 'FAILED' || orderStatus === 'PENDING'
        ? orderStatus : 'PENDING') as 'PENDING' | 'SUCCESS' | 'FAILED',
      create_time: raw.create_time || raw.created_at || '',
      update_time: raw.update_time || raw.updated_at || '',
      complete_time: raw.complete_time || (orderStatus === 'SUCCESS' ? (raw.update_time || '') : ''),
      balance_after: raw.balance_after != null ? Number(raw.balance_after) : undefined,
      card_available_balance: raw.card_available_balance != null ? Number(raw.card_available_balance) : undefined,
      balance_id: raw.balance_id || options.balanceId || undefined,
      raw_json: raw,
    };
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
   * 获取 UQPay 账户列表（用于获取 platform account_id / balance_id）
   *
   * API: GET /api/v1/accounts
   *
   * ⚠️ 已知问题：此端点对 Issuing 卡场景返回空数组。
   * 充值资金来源应使用 listIssuingBalances() 代替。
   *
   * 安全：不输出 token / clientId / apiKey
   *
   * @deprecated 使用 listIssuingBalances() 代替，该接口对 Issuing 卡场景返回空数组
   */
  async listAccounts(): Promise<Array<{
    account_id: string;
    name: string;
    currency: string;
    available_balance?: number;
    balance?: number;
    status?: string;
  }>> {
    const res = await this.request<{ data: any[] }>(
      'GET',
      '/api/v1/accounts?page_size=10000&page_number=1'
    );
    return (res.data || []).map((a: any) => ({
      account_id: a.account_id || a.id || '',
      name: a.name || '',
      currency: a.currency || '',
      available_balance: a.available_balance != null ? Number(a.available_balance) : undefined,
      balance: a.balance != null ? Number(a.balance) : undefined,
      status: a.status || undefined,
    }));
  }

  /**
   * 获取 UQPay Issuing 余额列表（充值资金来源）
   *
   * API: GET /api/v1/issuing/balances?page_number=1&page_size=N
   *
   * 这是 Issuing 卡充值场景的正确资金来源接口。
   * /api/v1/accounts 对 Issuing 卡场景返回空数组，
   * /api/v1/balances 返回多币种但 available_balance 全为 0，
   * 只有 /api/v1/issuing/balances 返回真实的 Issuing 级别资金池余额。
   *
   * 返回字段标准化：
   *   balance_id          - Issuing 余额 ID（UQPay 实际返回 balance_id，兼容 account_id / id）
   *   currency            - 币种（如 USD）
   *   available_balance   - 可用余额
   *   balance             - 总余额
   *   balance_status      - 余额状态（ACTIVE / DISABLED 等）
   *   raw_json            - 原始响应（用于调试，不含密钥）
   *
   * 安全：不输出 token / clientId / apiKey
   */
  async listIssuingBalances(params?: {
    pageNumber?: number;
    pageSize?: number;
  }): Promise<Array<{
    balance_id: string;
    currency: string;
    available_balance: number;
    balance: number;
    balance_status: string;
    raw_json: any;
  }>> {
    const pageNumber = params?.pageNumber ?? 1;
    const pageSize = params?.pageSize ?? 100;
    const res = await this.request<{ data: any[] }>(
      'GET',
      `/api/v1/issuing/balances?page_number=${pageNumber}&page_size=${pageSize}`
    );
    return (res.data || []).map((b: any) => ({
      balance_id: String(b.balance_id || b.account_id || b.id || ''),
      currency: String(b.currency || ''),
      available_balance: Number(b.available_balance ?? 0),
      balance: Number(b.balance ?? 0),
      balance_status: String(b.balance_status || b.status || 'UNKNOWN'),
      raw_json: b,
    }));
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

  // ── BIN 同步 ────────────────────────────────────────────────────────────

  /**
   * 将 UQPay 卡产品同步到 card_bins 表
   *
   * SINGLE-only 规则：
   * - 只将 mode_type=SINGLE、card_form 包含 VIR、card_currency 包含 USD、product_status=ENABLED/ACTIVE 的产品设置为 status=1
   * - SHARE 产品（及其他不符合条件的产品）保留在 card_bins 中，但 status=0，不可用于开卡
   * - 即使 UQPay 返回 SHARE 产品状态为 ENABLED，也强制设为 status=0
   * - 再次同步时不会把 SHARE 重新启用
   *
   * 字段映射：
   * - external_bin_id ← product_id
   * - bin_code ← card_bin
   * - card_brand ← card_scheme
   * - currency ← card_currency 中的第一个
   * - channel_code ← 'uqpay'
   * - raw_json ← 完整原始 JSON（不含密钥）
   */
  async syncCardProductsToBins(database: any): Promise<{ synced: number; total: number }> {
    const products = await this.listCardProducts();
    if (products.length === 0) {
      throw new Error('[UqPay] 未获取到任何卡产品，无法同步 BIN');
    }

    let synced = 0;

    // 收集所有已使用的 bin_code，处理同 BIN 多产品的情况
    const usedBinCodes = new Set<string>();

    for (const p of products) {
      const externalBinId = p.product_id;
      let binCode = p.card_bin || externalBinId.slice(0, 8);
      const binName = `UQPay ${p.card_scheme} ${p.mode_type}`;
      const cardBrand = p.card_scheme;
      const currency = p.card_currency[0] || 'USD';
      const rawJson = JSON.stringify(p);

      // SINGLE-only 规则：只有同时满足以下条件才 status=1
      const isEnabled = ['ENABLED', 'ACTIVE'].some(s => p.product_status.toUpperCase().includes(s));
      const isSingle = (p.mode_type || '').toUpperCase() === 'SINGLE';
      const hasVir = Array.isArray(p.card_form) && p.card_form.some((f: string) => f.toUpperCase() === 'VIR');
      const hasUsd = Array.isArray(p.card_currency) && p.card_currency.some((c: string) => c.toUpperCase() === 'USD');
      const status = (isSingle && hasVir && hasUsd && isEnabled) ? 1 : 0;

      // bin_code 有 UNIQUE 约束，同 BIN 多产品时追加序号避免冲突
      if (usedBinCodes.has(binCode)) {
        let suffix = 2;
        while (usedBinCodes.has(`${binCode}_${suffix}`)) suffix++;
        binCode = `${binCode}_${suffix}`;
      }
      usedBinCodes.add(binCode);

      // 检查是否已存在（按 channel_code + external_bin_id）
      const checkStmt = database.prepare('SELECT id, bin_code FROM card_bins WHERE channel_code = ? AND external_bin_id = ?');
      checkStmt.bind(['uqpay', externalBinId]);
      const exists = checkStmt.step();
      let existingId: number | null = null;
      if (exists) {
        const row = checkStmt.getAsObject();
        existingId = row?.id || null;
        // 已存在时复用原 bin_code 以避免不必要的变更
        if (row?.bin_code) binCode = row.bin_code;
      }
      checkStmt.free();

      if (existingId) {
        const updateStmt = database.prepare(
          'UPDATE card_bins SET bin_code=?, bin_name=?, card_brand=?, currency=?, status=?, raw_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
        );
        updateStmt.run([binCode, binName, cardBrand, currency, status, rawJson, existingId]);
        updateStmt.free();
      } else {
        const insertStmt = database.prepare(
          'INSERT INTO card_bins (channel_code, external_bin_id, bin_code, bin_name, card_brand, currency, country, status, raw_json) VALUES (?,?,?,?,?,?,?,?,?)'
        );
        insertStmt.run(['uqpay', externalBinId, binCode, binName, cardBrand, currency, 'US', status, rawJson]);
        insertStmt.free();
      }

      console.log(
        '[UqPay] BIN 同步:',
        existingId ? '更新' : '新增',
        `bin=${binCode}`,
        `scheme=${cardBrand}`,
        `mode=${p.mode_type}`,
        `product_status=${p.product_status}`,
        `bin_status=${status}${status === 0 ? ` (SINGLE-only, 原因: ${!isSingle ? 'mode=' + p.mode_type : !hasVir ? 'no VIR' : !hasUsd ? 'no USD' : 'disabled'})` : ''}`
      );
      synced++;
    }

    return { synced, total: products.length };
  }

  // ── 工具方法 ─────────────────────────────────────────────────────────────

  /**
   * 诊断接口: 检查 SDK 配置是否正确
   *
   * 安全：不输出 token / clientId / apiKey
   *
   * @returns 诊断结果，包含账户列表的 id / name / currency / status（不含密钥字段）
   */
  async diagnose(): Promise<{
    tokenOk: boolean;
    cardholderCount: number;
    cardProductCount: number;
    /** /api/v1/accounts 返回数量（通常为 0，Issuing 场景不适用） */
    accountsCount: number;
    /** /api/v1/balances 返回数量（非 issuing，available_balance 通常为 0） */
    balancesCount: number;
    /** /api/v1/issuing/balances 返回数量（✅ 充值资金来源） */
    issuingBalances: Array<{
      balance_id: string;
      currency: string;
      available_balance: number;
      balance: number;
      balance_status: string;
    }>;
    /** USD issuing balance（如果有） */
    usdIssuingBalance?: {
      balance_id: string;
      available_balance: number;
      balance: number;
      balance_status: string;
    };
    error?: string;
  }> {
    try {
      const token = await this.refreshToken();
      const [holders, products, accountsRes, balancesRes, issuingBalancesRaw] = await Promise.all([
        this.request<{ data: UqPayCardholder[] }>('GET', '/api/v1/issuing/cardholders?page_size=100&page_number=1'),
        this.request<{ data: any[] }>('GET', '/api/v1/issuing/products?page_size=100&page_number=1'),
        this.request<{ data: any[] }>('GET', '/api/v1/accounts?page_size=10000&page_number=1').catch(() => ({ data: [] as any[] })),
        this.request<{ data: any[] }>('GET', '/api/v1/balances?page_size=100&page_number=1').catch(() => ({ data: [] as any[] })),
        this.listIssuingBalances({ pageNumber: 1, pageSize: 100 }),
      ]);

      const issuingBalances = issuingBalancesRaw.map(b => ({
        balance_id: b.balance_id,
        currency: b.currency,
        available_balance: b.available_balance,
        balance: b.balance,
        balance_status: b.balance_status,
      }));

      // 识别 USD issuing balance（充值资金来源）
      const usdIssuingBalance = issuingBalancesRaw.find(b =>
        b.currency?.toUpperCase() === 'USD' &&
        b.balance_status?.toUpperCase() !== 'DISABLED'
      );

      return {
        tokenOk: !!token,
        cardholderCount: holders.data?.length ?? 0,
        cardProductCount: products.data?.length ?? 0,
        accountsCount: accountsRes.data?.length ?? 0,
        balancesCount: balancesRes.data?.length ?? 0,
        issuingBalances,
        usdIssuingBalance: usdIssuingBalance ? {
          balance_id: usdIssuingBalance.balance_id,
          available_balance: usdIssuingBalance.available_balance,
          balance: usdIssuingBalance.balance,
          balance_status: usdIssuingBalance.balance_status,
        } : undefined,
      };
    } catch (err: any) {
      return {
        tokenOk: false,
        cardholderCount: 0,
        cardProductCount: 0,
        accountsCount: 0,
        balancesCount: 0,
        issuingBalances: [],
        error: err?.message || String(err),
      };
    }
  }
}

export default UqPaySDK;
