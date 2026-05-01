/**
 * 多渠道持卡人适配器注册中心
 *
 * 使用方式：
 *   const adapter = getCardholderAdapter('DOGPAY')
 *   adapter.validate(row)
 *   adapter.createCardholder(input)
 *
 * 新增渠道：
 *   1. 新建 xxx-cardholder-adapter.ts 实现 CardholderAdapter
 *   2. 在 ADAPTER_REGISTRY 中注册
 *   3. 路由层无需修改
 */

import { CardholderAdapter } from './types';
import { dogpayCardholderAdapter } from './dogpay-cardholder-adapter';

const ADAPTER_REGISTRY: Record<string, CardholderAdapter> = {
  DOGPAY: dogpayCardholderAdapter,
};

/**
 * 获取指定渠道的持卡人适配器
 * @throws Error 如果渠道代码不存在
 */
export function getCardholderAdapter(channelCode: string): CardholderAdapter {
  const code = channelCode.toUpperCase().trim();
  const adapter = ADAPTER_REGISTRY[code];
  if (!adapter) {
    throw new Error(`暂不支持该持卡人渠道: ${code}`);
  }
  return adapter;
}

/**
 * 注册新的持卡人适配器（供后续渠道扩展使用）
 */
export function registerCardholderAdapter(adapter: CardholderAdapter): void {
  ADAPTER_REGISTRY[adapter.channelCode.toUpperCase()] = adapter;
}

/**
 * 列出所有已注册的渠道代码
 */
export function listChannelCodes(): string[] {
  return Object.keys(ADAPTER_REGISTRY);
}
