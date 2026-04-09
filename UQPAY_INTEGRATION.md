# UQPay Issuing API 对接文档

**更新时间**: 2026-04-09
**API 版本**: v1.6.0
**文档**: https://docs.uqpay.com

---

## 1. 概述

UQPay 是一个发卡（Issuing）平台，提供虚拟卡/实体卡管理、KYC、钱包充值等能力。本系统通过 `server/src/channels/uqpay.ts` 中的 `UqPaySDK` 与其对接。

### 核心 API 端点

| 环境 | Base URL |
|------|----------|
| Sandbox | `https://api-sandbox.uqpaytech.com` |
| Production | `https://api.uqpaytech.com` |

---

## 2. 认证方式

### 获取 Access Token

```
POST /api/v1/connect/token
Header:
  x-client-id: <your_client_id>
  x-api-key:   <your_api_key>
```

返回：
```json
{
  "auth_token": "eyJ...",
  "expired_at": "2026-04-09T11:00:00Z"
}
```

Token 有效期 30 分钟（生产环境）。`UqPaySDK` 自动管理 token 刷新（提前 5 分钟刷新）。

后续所有请求 Header 中带：
```
x-auth-token: <auth_token>
```

---

## 3. 已实现的 API

### 3.1 持卡人 (Cardholder)

| 操作 | 端点 | 方法 |
|------|------|------|
| 创建持卡人 | `/api/v1/issuing/cardholders` | POST |
| 获取持卡人详情 | `/api/v1/issuing/cardholders/{id}` | GET |
| 列出持卡人 | `/api/v1/issuing/cardholders` | GET |

**创建持卡人请求体**：
```json
{
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "country_code": "US",
  "phone_number": "+10000000000",
  "nationality": "US"
}
```

> ⚠️ **幂等性**: 每次请求必须带 `x-idempotency-key`（UUID），防止重复创建。

**SDK 方法**：
```ts
await sdk.getOrCreateCardholder({
  email: user.email,
  firstName: firstName,
  lastName: lastName,
  countryCode: 'US',
  phoneNumber: phone,
  nationality: countryCode,
});
```

---

### 3.2 卡产品 (Card Products)

| 操作 | 端点 | 方法 |
|------|------|------|
| 列出卡产品 | `/api/v1/issuing/products?page_size=100&page_number=1` | GET |

返回每个产品的 `id`（即 `card_product_id`），是创建卡片的必需参数。

**SDK 方法**：
```ts
// 自动查找 USD 可用产品
const productId = await sdk.getCardProductId('USD');
```

---

### 3.3 卡片管理 (Cards)

| 操作 | 端点 | 方法 |
|------|------|------|
| 创建卡片 | `/api/v1/issuing/cards` | POST |
| 获取卡片详情 | `/api/v1/issuing/cards/{id}` | GET |
| 更新卡片状态 | `/api/v1/issuing/cards/{id}` | POST |
| 列出所有卡片 | `/api/v1/issuing/cards` | GET |

**卡片状态枚举**：
- `PENDING` - 待处理
- `ACTIVE` - 激活
- `FROZEN` - 冻结
- `BLOCKED` - 已封锁
- `CANCELLED` - 已取消
- `LOST` - 挂失
- `STOLEN` - 被盗
- `FAILED` - 失败

**创建卡片请求体**：
```json
{
  "cardholder_id": "<cardholder_uuid>",
  "card_product_id": "<product_id>",
  "card_currency": "USD",
  "card_limit": 1000.00,
  "usage_type": "NORMAL",
  "metadata": { "userId": "123", "cardName": "Shopping Card" }
}
```

**更新卡片状态（冻结/解冻/取消）**：
```json
{
  "card_status": "FROZEN"
}
```

**SDK 方法**：
```ts
// 创建卡
const card = await sdk.createCard({
  cardholderId: cardholderId,
  cardProductId: productId,
  cardCurrency: 'USD',
  cardLimit: 1000,
  cardType: 'virtual',
});

// 冻结
await sdk.freezeCard(cardId);

// 解冻
await sdk.unfreezeCard(cardId);

// 取消
await sdk.cancelCard(cardId);
```

> ⚠️ **PCI DSS 合规**: UQPay API 创建卡后不返回明文卡号/CVV（安全设计）。通过 Secure iFrame 安全展示卡面信息（见 3.5 节）。

---

### 3.4 Secure iFrame — 安全展示卡面信息

**文档**: https://docs.uqpay.com/docs/secure-iframe-guide

PCI DSS 合规方案：通过一次性 PAN Token + 嵌入式 iFrame，用户无需在 API 响应中传输明文卡号，即可安全查看完整卡号/CVV/有效期。

#### 流程

```
1. POST /api/v1/cards/{id}/pan-token
   → 后端调用 UQPay API 创建 PAN Token

2. 后端返回 iframeUrl（有效期 60 秒，仅可使用一次）

3. 前端嵌入 iFrame：
   <iframe src="{iframeUrl}" width="480" height="300" frameborder="0"></iframe>

4. 用户在 iFrame 内查看完整卡号、有效期、CVV
```

#### API 端点

```
POST /api/v1/issuing/cards/{card_id}/token

Header:
  x-auth-token: <auth_token>
  Accept: application/json
  x-idempotency-key: <uuid>
```

返回：
```json
{
  "token": "pan_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 60,
  "expires_at": "2025-11-13T10:31:00Z"
}
```

#### iFrame URL 格式

```
{iframe_domain}/iframe/card?token={pan_token}&cardId={card_id}&lang={lang}

# 示例
https://embedded-sandbox.uqpaytech.com/iframe/card?token=pan_xxx&cardId=7242a504-...&lang=zh
```

| 环境 | iframe_domain |
|------|--------------|
| Sandbox | `https://embedded-sandbox.uqpaytech.com` |
| Production | `https://embedded.uqpay.com` |

#### SDK 方法

```ts
// 生成 PAN Token
const { token, expiresIn, expiresAt } = await sdk.getPanToken(cardId);

// 构建可直接使用的 iFrame URL
const iframeUrl = sdk.buildSecureIframeUrl(token, cardId, 'zh');
```

#### 前端嵌入示例

```html
<!-- 开卡成功后，前端调用 GET /api/v1/cards/{id}/pan-token -->
<!-- 将返回的 iframeUrl 设置为 iframe src -->

<template>
  <div v-if="iframeUrl">
    <p>有效期：{{ expiresIn }}秒，请在到期前完成查看</p>
    <iframe
      :src="iframeUrl"
      width="480"
      height="320"
      frameborder="0"
      allowtransparency="true"
    ></iframe>
  </div>
  <div v-else>
    <button @click="fetchPanToken">查看完整卡号</button>
  </div>
</template>

<script setup>
// 调用 GET /api/v1/cards/{id}/pan-token
const { data } = await fetch('/api/v1/cards/' + cardId + '/pan-token', {
  headers: { Authorization: 'Bearer ' + token }
});
iframeUrl.value = data.iframeUrl;
expiresIn.value = data.expiresIn;
</script>
```

#### 注意事项

- **Token 仅一次**: 每次查看卡号必须重新调用 `/pan-token`
- **有效期 60 秒**: 用户需在 60 秒内完成查看
- **沙箱预览工具**: `https://embedded-sandbox.uqpaytech.com/iframe/preview/`

---

### 3.5 转账 (Transfer) — 钱包充值

| 操作 | 端点 | 方法 |
|------|------|------|
| 创建转账 | `/api/v1/transfer` | POST |
| 转账列表 | `/api/v1/transfer` | GET |

**充值流程**：
1. 用户向平台在 UQPay 的钱包地址转账 USDT
2. 平台监听链上到账（通过 Webhook 或轮询）
3. 确认后调用 Transfer API 将资金转入发卡账户

**创建转账请求体**：
```json
{
  "source_account_id": "<平台账户ID>",
  "target_account_id": "<持卡人账户ID>",
  "currency": "USD",
  "amount": "100.00",
  "reason": "Card wallet top-up"
}
```

**SDK 方法**：
```ts
const transfer = await sdk.transferToCard(
  sourceAccountId,
  targetAccountId,
  100,
  'USD'
);
```

---

## 4. 渠道配置 (card_channels 表)

在 `card_channels` 表中配置 UQPay 渠道：

```sql
INSERT INTO card_channels
  (channel_code, channel_name, api_base_url, api_key, api_secret, status, config_json)
VALUES
  ('UQPAY', 'UQPay 发卡', 'https://api-sandbox.uqpaytech.com', '<client_id>', '<api_key>', 1,
   '{"clientId":"<client_id>","apiSecret":"<api_secret>","depositAddresses":{"trx":"TRC20地址","eth":"ERC20地址","bnb":"BEP20地址"}}');
```

### config_json 字段说明

| 字段 | 说明 |
|------|------|
| `clientId` | UQPay Client ID（可替代 api_key） |
| `apiSecret` | UQPay API Secret（可替代 api_secret） |
| `depositAddresses.trx` | 平台 TRC20 USDT 充值地址 |
| `depositAddresses.eth` | 平台 ERC20 USDT 充值地址 |
| `depositAddresses.bnb` | 平台 BEP20 USDT 充值地址 |

---

## 5. 数据库字段变更

```sql
-- cards 表新增 channel_code 字段
ALTER TABLE cards ADD COLUMN channel_code VARCHAR(20) DEFAULT 'MOCK';

-- usdt_orders 表新增 uqpay_order_id 字段
ALTER TABLE usdt_orders ADD COLUMN uqpay_order_id VARCHAR(100);
```

---

## 6. 接口路由映射

| 功能 | 路由 | SDK 方法 |
|------|------|---------|
| 获取充值地址 | `GET /api/v1/wallet/address` | getDepositAddress |
| 创建充值订单 | `POST /api/v1/wallet/deposit/c2c` | createC2COrder |
| 创建卡片 | `POST /api/v1/cards` | getOrCreateCardholder + createCard |
| 冻结卡片 | `POST /api/v1/cards/:id/freeze` | freezeCard |
| 解冻卡片 | `POST /api/v1/cards/:id/unfreeze` | unfreezeCard |
| 注销卡片 | `POST /api/v1/cards/:id/cancel` | cancelCard |
| 查看卡面（Mock/DogPay） | `GET /api/v1/cards/:id/reveal` | 直接返回明文 |
| 查看卡面（UQPay） | `GET /api/v1/cards/:id/pan-token` | getPanToken + buildSecureIframeUrl |

---

## 7. 渠道优先级

系统支持多渠道自动切换，优先级：

1. **UQPAY** — 最高优先级，`channel_code = 'UQPAY'` 且 `status = 1`
2. **DogPay** — 备选渠道，`channel_code = 'dogpay'` 且 `status = 1`
3. **Mock** — 无渠道时降级，本地生成假卡数据（仅测试用）

---

## 8. Webhook 配置（建议）

建议配置 UQPay Webhook 接收以下事件：

| 事件 | 说明 |
|------|------|
| `card.created` | 新卡创建成功 |
| `card.status_changed` | 卡片状态变更（冻结/解冻/取消） |
| `transfer.completed` | 转账完成（充值确认） |
| `card.transaction` | 卡片消费/退款通知 |

Webhook 地址：`POST /api/v1/webhooks/uqpay`

---

## 9. 沙箱测试账号申请

1. 登录 UQPay 开发者平台
2. 进入「API Keys」页面生成 `client_id` 和 `api_key`
3. 在 Dashboard 申请发卡账户权限
4. 配置测试卡产品（Sandbox 环境下卡产品 ID 不同）

---

## 10. 常见问题

**Q: 创建持卡人失败（400/401）？**
A: 检查 `x-client-id` 和 `x-api-key` 是否正确，确认账户已开通发卡权限。

**Q: 卡产品 ID 如何获取？**
A: 调用 `GET /api/v1/issuing/products` 列出可用产品。

**Q: 充值地址不返回？**
A: 确认 `card_channels.config_json` 中已配置 `depositAddresses` 对象。

**Q: 明文卡号/CVV 如何获取？**
A: UQPay 不在 API 响应中返回明文（PCI DSS 合规）。通过 Secure iFrame 安全展示：
   1. 调用 `GET /api/v1/cards/{id}/pan-token` 获取 iframeUrl
   2. 将 iframeUrl 嵌入 `<iframe>` 标签
   3. 用户在 iFrame 内查看完整卡号/CVV/有效期（Token 有效期 60 秒）

**Q: 为什么需要 /pan-token 端点，不能直接返回 iframeUrl？**
A: PAN Token 有效期仅 60 秒且仅可使用一次。如果在开卡时返回，用户稍后打开页面时 Token 已过期。必须由用户在需要查看时实时请求。

**Q: 如何从 DogPay 切换到 UQPay？**
A: 将 `card_channels` 中 DogPay 记录 `status = 0`，添加 UQPay 记录 `status = 1`，重启服务即可自动切换。
