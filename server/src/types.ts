// ── 原有类型（来自 types.ts 历史版本）────────────────────────────

export interface User {
  id: number;
  user_no: string;
  phone?: string;
  email?: string;
  password_hash: string;
  salt: string;
  status: number;
  kyc_status: number;
  created_at: string;
  updated_at: string;
}

export interface KYCRecord {
  id: number;
  user_id: number;
  subject_type: number; // 1-个人, 2-企业
  real_name: string;
  id_number: string;
  id_type: number; // 1-身份证, 2-护照, 3-营业执照
  id_front_url?: string;
  id_back_url?: string;
  id_hold_url?: string;
  id_expire_date?: string;
  status: number; // 0-待审核, 1-审核中, 2-通过, 3-拒绝
  reject_reason?: string;
  auditor_id?: number;
  audited_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: number;
  card_no: string;
  card_no_masked: string;
  user_id: number;
  card_name: string;
  card_type: string; // AD-广告卡, PROC-采购卡, SUB-订阅卡
  currency: string;
  balance: number;
  credit_limit: number;
  single_limit?: number;
  daily_limit?: number;
  status: number; // 1-正常, 2-冻结, 3-已过期, 4-已注销, 0-待激活
  expire_date: string;
  cvv: string;
  purpose?: string;
  created_at: string;
  updated_at: string;
  // 以下字段通过 ALTER TABLE 动态添加，对应 index.ts 中的迁移
  channel_code?: string;
  external_id?: string;
  uqpay_cardholder_id?: string;
  card_order_id?: string;
  balance_id?: string;
}

export interface Transaction {
  id: number;
  txn_no: string;
  card_id: number;
  user_id: number;
  txn_type: string; // PURCHASE, REFUND, TOPUP, FEE, MONTHLY_FEE, CANCEL_REFUND
  amount: number;
  fee: number;
  currency: string;
  status: number; // 0-处理中 1-成功 2-失败 3-撤销 4-过期 5-已退款
  merchant_name?: string;
  merchant_category?: string;
  auth_code?: string;
  reference_no?: string;
  txn_time: string;
  settled_time?: string;
  created_at: string;
  // 状态机扩展字段（通过 ALTER TABLE 动态添加）
  event_type?: string;
  attempts?: number;
  expires_at?: string;
  channel_order_no?: string;
  channel_code?: string;
}

export interface Bill {
  id: number;
  user_id: number;
  month: string;
  total_spend: number;
  total_topup: number;
  total_fee: number;
  created_at: string;
}

export interface Notice {
  id: number;
  title: string;
  content: string;
  type: string;
  status: number;
  top: number;
  created_at: string;
}

export interface JWTPayload {
  userId: number;
  userNo: string;
}

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
  timestamp: number;
}

// ── 支付状态机类型（新增）──────────────────────────────────────

/**
 * CardGoLink 支付状态机类型扩展
 * 支持事件驱动架构：AUTH → CAPTURE → SETTLE → REFUND/CHARGEBACK
 *
 * 状态（status）定义：
 *   0 - PENDING      待处理/处理中
 *   1 - SUCCESS      成功/已确认
 *   2 - FAILED       失败
 *   3 - REVERSED     已撤销
 *   4 - EXPIRED      已过期
 *   5 - REFUNDED     已退款（独立状态）
 *
 * 事件（event_type）定义：
 *   AUTH            授权请求
 *   AUTH_CAP        授权并扣款（合并）
 *   CANCEL          取消授权（释放预授权额度）
 *   CAPTURE         确认扣款（从预授权变为实际扣款）
 *   REFUND          退款
 *   PARTIAL_REFUND  部分退款
 *   CHARGEBACK      拒付
 *   CHARGEBACK_REVERSE  拒付撤回
 */

/** 交易状态 */
export enum PaymentStatus {
  PENDING   = 0,
  SUCCESS   = 1,
  FAILED    = 2,
  REVERSED  = 3,
  EXPIRED   = 4,
  REFUNDED  = 5,
}

/** 事件类型 */
export enum PaymentEventType {
  AUTH                 = 'AUTH',
  AUTH_CAP             = 'AUTH_CAP',
  CANCEL               = 'CANCEL',
  CAPTURE              = 'CAPTURE',
  REFUND               = 'REFUND',
  PARTIAL_REFUND       = 'PARTIAL_REFUND',
  CHARGEBACK           = 'CHARGEBACK',
  CHARGEBACK_REVERSE   = 'CHARGEBACK_REVERSE',
}

/** 渠道原始状态 */
export enum ChannelStatus {
  PENDING              = 0,
  PAID                 = 1,
  FAILED               = 2,
  EXPIRED              = 3,
  CANCELLED            = 4,
  REFUNDED             = 5,
  PARTIAL_PAID         = 6,
}

/** 渠道代码 */
export enum ChannelCode {
  AIRWALLEX = 'AIRWALLEX',
  PHOTON    = 'PHOTON',
  UQPAY     = 'UQPAY',
  COINPAY   = 'COINPAY',
  COINPAL   = 'COINPAL',
  DOGPAY    = 'DOGPAY',
}

// ── 状态转换规则 ─────────────────────────────────────────────

/** 允许的状态转换表 */
export const PAYMENT_TRANSITIONS: Record<string, { from: PaymentStatus[]; to: PaymentStatus }> = {
  [PaymentEventType.AUTH]: {
    from: [],
    to: PaymentStatus.PENDING,
  },
  [PaymentEventType.AUTH_CAP]: {
    from: [],
    to: PaymentStatus.PENDING,
  },
  [PaymentEventType.CAPTURE]: {
    from: [PaymentStatus.PENDING],
    to: PaymentStatus.SUCCESS,
  },
  [PaymentEventType.CANCEL]: {
    from: [PaymentStatus.PENDING],
    to: PaymentStatus.REVERSED,
  },
  [PaymentEventType.REFUND]: {
    from: [PaymentStatus.SUCCESS],
    to: PaymentStatus.REFUNDED,
  },
  [PaymentEventType.PARTIAL_REFUND]: {
    from: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED],
    to: PaymentStatus.REFUNDED,
  },
  [PaymentEventType.CHARGEBACK]: {
    from: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED],
    to: PaymentStatus.FAILED,
  },
  [PaymentEventType.CHARGEBACK_REVERSE]: {
    from: [PaymentStatus.FAILED],
    to: PaymentStatus.SUCCESS,
  },
};

/** 检查状态转换是否合法 */
export function canTransition(eventType: PaymentEventType, fromStatus: number): boolean {
  const rule = PAYMENT_TRANSITIONS[eventType];
  if (!rule) return false;
  if (rule.from.length === 0) return true;
  return rule.from.includes(fromStatus);
}

// ── 渠道状态映射表 ────────────────────────────────────────────

/**
 * 将渠道原始状态映射为统一状态
 * CoinPay 状态 → CardGoLink Status
 *   unpaid/pending/partial_paid_confirming  → 0 (PENDING)
 *   paid/paid_confirming/partial_paid       → 1 (SUCCESS)
 *   failed                                  → 2 (FAILED)
 *   expired                                 → 4 (EXPIRED)
 *   cancelled                               → 3 (REVERSED)
 */
export const COINPAY_STATUS_MAP: Record<string, number> = {
  'unpaid':                   PaymentStatus.PENDING,
  'pending':                  PaymentStatus.PENDING,
  'partial_paid_confirming':  PaymentStatus.PENDING,
  'paid':                    PaymentStatus.SUCCESS,
  'paid_confirming':         PaymentStatus.SUCCESS,
  'partial_paid':            PaymentStatus.SUCCESS,
  'failed':                   PaymentStatus.FAILED,
  'expired':                  PaymentStatus.EXPIRED,
  'cancelled':               PaymentStatus.REVERSED,
};

export const COINPAL_STATUS_MAP: Record<string, number> = {
  'pending':    PaymentStatus.PENDING,
  'paid':       PaymentStatus.SUCCESS,
  'confirmed':  PaymentStatus.SUCCESS,
  'failed':     PaymentStatus.FAILED,
  'expired':    PaymentStatus.EXPIRED,
  'cancelled':  PaymentStatus.REVERSED,
};

/**
 * 统一渠道状态转换函数
 * @param channelCode 渠道代码
 * @param rawStatus 渠道原始状态字符串
 */
export function mapChannelStatus(channelCode: string, rawStatus: string): number {
  const upperChannel = (channelCode || '').toUpperCase();
  if (upperChannel === 'COINPAY') return COINPAY_STATUS_MAP[rawStatus] ?? PaymentStatus.PENDING;
  if (upperChannel === 'COINPAL') return COINPAL_STATUS_MAP[rawStatus] ?? PaymentStatus.PENDING;
  return PaymentStatus.PENDING;
}
