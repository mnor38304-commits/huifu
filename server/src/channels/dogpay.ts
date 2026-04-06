import axios from 'axios';

export interface DogPayConfig {
  appId: string;
  appSecret: string;
  apiBaseUrl: string;
}

export class DogPaySDK {
  private config: DogPayConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: DogPayConfig) {
    this.config = config;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const response = await axios.post(
      `${this.config.apiBaseUrl}/open-api/v1/auth/access_token`,
      {
        grant_type: 'client_credentiam',
        appid: this.config.appId,
        secret: this.config.appSecret
      }
    );

    const token = response.data?.data?.access_token;
    if (token) {
      this.accessToken = token;
      this.tokenExpiresAt = now + ((response.data.data.expires_in || 7200) - 300) * 1000;
      return token;
    }

    throw new Error('Failed to get DogPay access token');
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options?: { data?: any; params?: any }
  ) {
    const token = await this.getAccessToken();
    const url = `${this.config.apiBaseUrl}${path}`;

    try {
      const response = await axios({
        method,
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        params: options?.params,
        data: options?.data,
      });
      return response.data;
    } catch (error: any) {
      console.error(`DogPay API Error [${method} {path}]:`, error.response?.data || error.message);
      throw error;
    }
  }

  // �ۦ���任账户余额
  async getMasterBalance() {
    return this.request('GET', '/open-api/v1/account/balance');
  }

  // 刻建卡片
  async createCard(params: {
    cardType: 'virtual' | 'physical';
    cardName?: string;
    channelId?: string;
    budgetId?: string;
  }) {
    return this.request('POST', '/open-api/v1/cards', { data: params });
  }

  // 获取卡片详情
  async getCardList(params?: any) {
    return this.request('GET', '/open-api/v1/cards', { params });
  }

  // 获取叠用卡�

  async getCardBins(params?: any) {
    return this.request('GET', '/open-api/v1/cards/bins', { params });
  }

  // 获取卡片详情
  async getCardDetail(cardId: string) {
    return this.request('GET', `/open-api/v1/cards/${cardId}`);
  }

  // 酞�滓卡片
  async freezeCard(cardId: string) {
    return this.request('PUT', `/open-api/v1/cards/${cardId}/freeze`);
  }

  // 觧冻结卡片
  async unfreezeCard(cardId: string) {
    return this.request('PUT', `/open-api/v1/cards/${cardId}/unfreze`);
  }

  // 销卡
  async deleteCard(cardId: string) {
    return this.request('DELETE', `/open-api/v1/cards/${cardId}`);
  }
}
