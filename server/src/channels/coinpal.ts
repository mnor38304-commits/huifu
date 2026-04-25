/**
 * CoinPal SDK 模块（重构版 v2）
 * 对接文档：https://docs.coinpal.io/  (Gitee: https://gitee.com/coinpal/docs)
 *
 * 核心差异（vs 旧版）：
 * - API 地址：https://pay.coinpal.io/gateway/pay/checkout（form-data，非 JSON）
 * - 签名：sha256(secretKey + requestId + merchantNo + orderNo + orderAmount + orderCurrency)
 * - 返回：nextStep=redirect 时，跳转至 CoinPal 收银台（用户扫码/复制地址充值）
 * - 状态同步：CoinPal 通过 IPN 回调 notifyURL 通知商户
 */

import crypto from 'crypto';

export interface CoinPalConfig {
  merchantNo: string;
  secretKey: string;
  apiBaseUrl?: string;
}

export interface CreateOrderParams {
  amount: number;        // 充值金额（USDT）
  userId: string;
  orderNo: string;       // 商户内部订单号（幂等）
  notifyUrl: string;     // IPN 回调地址
  redirectUrl: string;   // 前端跳转地址（支付完成/过期后）
  payerIp?: string;
  orderDescription?: string;
}

export interface CoinPalOrderResult {
  reference: string;      // CoinPal 平台订单号（CWSxxx）
  paymentUrl: string;      // 收银台跳转链接
  status: string;          // created / pending / paid / failed
  respCode: number;
  respMessage: string;
}

export class CoinPalSDK {
  private merchantNo: string;
  private secretKey: string;
  private apiBaseUrl: string;

  constructor(config: CoinPalConfig) {
    this.merchantNo = config.merchantNo;
    this.secretKey = config.secretKey;
    this.apiBaseUrl = config.apiBaseUrl ? config.apiBaseUrl : 'https://pay.coinpal.io';
  }

  /**
   * 生成签名（按 CoinPal 文档公式）
   * sign = sha256(secretKey + requestId + merchantNo + orderNo + orderAmount + orderCurrency)
   */
  private buildSign(requestId: string, orderNo: string, orderAmount: string, orderCurrency: string): string {
    const signStr = this.secretKey + requestId + this.merchantNo + orderNo + orderAmount + orderCurrency;
    return crypto.createHash('sha256').update(signStr).digest('hex');
  }

  /**
   * 创建支付订单
   * @returns paymentUrl（收银台链接，前端需跳转至此）
   */
  async createOrder(params: CreateOrderParams): Promise<CoinPalOrderResult> {
    const requestId = 'REQ' + Date.now() + Math.floor(Math.random() * 10000);
    const orderCurrency = 'USDT';
    const orderAmount = String(params.amount);

    // 1. 构建签名字符串（不含 sign 本身）
    const sign = this.buildSign(requestId, params.orderNo, orderAmount, orderCurrency);

    // 2. 构建 form-data 请求体
    const body = new URLSearchParams();
    body.append('version', '2');
    body.append('requestId', requestId);
    body.append('merchantNo', this.merchantNo);
    body.append('merchantName', 'CardGoLink');
    body.append('orderNo', params.orderNo);
    body.append('orderCurrencyType', 'crypto');
    body.append('orderCurrency', orderCurrency);
    body.append('orderAmount', orderAmount);
    const desc = params.orderDescription ? params.orderDescription : 'USDT Deposit for user ' + params.userId;
    body.append('orderDescription', desc);
    body.append('resultNotifyUser', 'false');
    body.append('unpaidAutoRefund', 'true');
    const payerIp = params.payerIp ? params.payerIp : '127.0.0.1';
    body.append('payerIP', payerIp);
    body.append('notifyURL', params.notifyUrl);
    body.append('redirectURL', params.redirectUrl);
    body.append('sign', sign);

    // 3. 调用 CoinPal API（form-data POST）
    const url = this.apiBaseUrl + '/gateway/pay/checkout';
    let resp: globalThis.Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          // 不设置 Content-Type，让 fetch 自动设为 application/x-www-form-urlencoded
        },
        body: body.toString(),
      });
    } catch (err: any) {
      throw new Error('[CoinPal] 网络请求失败: ' + err.message);
    }

    const data: any = await resp.json();

    if (data.respCode !== 200) {
      throw new Error('[CoinPal] respCode=' + data.respCode + ' respMessage=' + (data.respMessage || 'Unknown'));
    }

    return {
      reference: data.reference ? data.reference : '',
      paymentUrl: data.nextStepContent ? data.nextStepContent : '',
      status: data.status ? data.status : 'created',
      respCode: data.respCode,
      respMessage: data.respMessage ? data.respMessage : 'success',
    };
  }

  /**
   * 查询订单状态
   */
  async queryOrder(reference: string): Promise<any> {
    const url = this.apiBaseUrl + '/gateway/pay/query';
    const body = new URLSearchParams();
    body.append('reference', reference);
    const resp = await fetch(url, { method: 'POST', body });
    return resp.json();
  }

  /**
   * 验证 IPN 回调签名
   * sign = sha256(secretKey + requestId + merchantNo + orderNo + orderAmount + orderCurrency)
   */
  verifyNotifySign(params: Record<string, string>): boolean {
    const { sign, ...rest } = params;
    const sig = this.secretKey
      + (rest['requestId'] ? rest['requestId'] : '')
      + (rest['merchantNo'] ? rest['merchantNo'] : '')
      + (rest['orderNo'] ? rest['orderNo'] : '')
      + (rest['orderAmount'] ? rest['orderAmount'] : '')
      + (rest['orderCurrency'] ? rest['orderCurrency'] : '');
    return crypto.createHash('sha256').update(sig).digest('hex') === sign;
  }
}

export default CoinPalSDK;