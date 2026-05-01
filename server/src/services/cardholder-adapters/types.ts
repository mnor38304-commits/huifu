/**
 * 多渠道持卡人适配器 — 公共类型
 *
 * 每个卡渠道（DogPay、UQPay 等）实现 CardholderAdapter 接口，
 * 统一管理持卡人的字段定义、校验、格式化和创建。
 */

/** 表单字段类型 */
export type FieldType = 'text' | 'select' | 'password' | 'email' | 'tel';

/** 单个字段定义 */
export interface FieldSchema {
  name: string;               // 字段名（驼峰）
  label: string;              // 显示标签
  type: FieldType;            // 表单控件类型
  required: boolean;          // 是否必填
  placeholder?: string;       // 输入提示
  defaultValue?: any;         // 默认值（如 'US'）
  pattern?: RegExp;           // 正则校验
  patternMessage?: string;    // 正则不通过时的提示
  minLength?: number;
  maxLength?: number;
  /** 如果是 select 类型，可选值列表 */
  options?: { value: any; label: string }[];
  /** 示例值（用于 CSV 模板列头和说明） */
  example?: string;
  /** 描述说明 */
  description?: string;
}

/** schema 接口返回 */
export interface CardholderFieldSchema {
  channelCode: string;
  fields: FieldSchema[];
  csvHeader: string;   // CSV 表头行
  csvExample: string;  // CSV 示例行
}

/** 单行校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data: Record<string, any>;  // 清洗后的数据
}

/** 标准化后的持卡人输入（无关渠道通信格式） */
export interface NormalizedCardholderInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  countryCode: string;
  idType?: number;
  idNumber?: string;
  /** 渠道专有扩展字段 */
  extra?: Record<string, any>;
}

/** 持卡人创建结果 */
export interface CardholderCreateResult {
  externalId: string;
  status: string;
  kycStatus: string;
  rawResponse?: any;
}

/** 每个渠道 adapter 的统一接口 */
export interface CardholderAdapter {
  /** 渠道代码（大写，如 DOGPAY） */
  channelCode: string;

  /** 获取该渠道的字段定义 */
  getSchema(): CardholderFieldSchema;

  /** 校验单行输入 */
  validate(input: Record<string, any>, rowIndex?: number): ValidationResult;

  /** 标准化输入（清洗、trim、toUpperCase 等） */
  normalize(input: Record<string, any>): NormalizedCardholderInput;

  /** 在对应渠道创建持卡人 */
  createCardholder(input: NormalizedCardholderInput): Promise<CardholderCreateResult>;

  /** 获取 CSV 模板字符串 */
  getCsvTemplate(): string;
}
