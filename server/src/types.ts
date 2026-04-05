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
}

export interface Transaction {
  id: number;
  txn_no: string;
  card_id: number;
  user_id: number;
  txn_type: string; // PURCHASE, REFUND, TOPUP, FEE, MONTHLY_FEE, CANCEL_REFUND
  amount: number;
  currency: string;
  status: number; // 1-成功, 2-失败, 0-处理中, 3-已撤销
  merchant_name?: string;
  merchant_category?: string;
  auth_code?: string;
  reference_no?: string;
  txn_time: string;
  settled_time?: string;
  created_at: string;
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
