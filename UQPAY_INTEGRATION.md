# UQPay Issuing API 瀵规帴鏂囨。

**鏇存柊鏃堕棿**: 2026-04-09
**API 鐗堟湰**: v1.6.0
**鏂囨。**: https://docs.uqpay.com

---

## 1. 姒傝堪

UQPay 鏄竴涓彂鍗★紙Issuing锛夊钩鍙帮紝鎻愪緵铏氭嫙鍗?瀹炰綋鍗＄鐞嗐€並YC銆侀挶鍖呭厖鍊肩瓑鑳藉姏銆傛湰绯荤粺閫氳繃 `server/src/channels/uqpay.ts` 涓殑 `UqPaySDK` 涓庡叾瀵规帴銆?

### 鏍稿績 API 绔偣

| 鐜 | Base URL |
|------|----------|
| Sandbox | `https://api-sandbox.uqpaytech.com` |
| Production | `https://api.uqpaytech.com` |

---

## 2. 璁よ瘉鏂瑰紡

### 鑾峰彇 Access Token

```
POST /api/v1/connect/token
Header:
  x-client-id: <your_client_id>
  x-api-key:   <your_api_key>
```

杩斿洖锛?
```json
{
  "auth_token": "eyJ...",
  "expired_at": "2026-04-09T11:00:00Z"
}
```

Token 鏈夋晥鏈?30 鍒嗛挓锛堢敓浜х幆澧冿級銆俙UqPaySDK` 鑷姩绠＄悊 token 鍒锋柊锛堟彁鍓?5 鍒嗛挓鍒锋柊锛夈€?

鍚庣画鎵€鏈夎姹?Header 涓甫锛?
```
x-auth-token: <auth_token>
```

---

## 3. 宸插疄鐜扮殑 API

### 3.1 鎸佸崱浜?(Cardholder)

| 鎿嶄綔 | 绔偣 | 鏂规硶 |
|------|------|------|
| 鍒涘缓鎸佸崱浜?| `/api/v1/issuing/cardholders` | POST |
| 鑾峰彇鎸佸崱浜鸿鎯?| `/api/v1/issuing/cardholders/{id}` | GET |
| 鍒楀嚭鎸佸崱浜?| `/api/v1/issuing/cardholders` | GET |

**鍒涘缓鎸佸崱浜鸿姹備綋**锛?
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

> 鈿狅笍 **骞傜瓑鎬?*: 姣忔璇锋眰蹇呴』甯?`x-idempotency-key`锛圲UID锛夛紝闃叉閲嶅鍒涘缓銆?

**SDK 鏂规硶**锛?
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

### 3.2 鍗′骇鍝?(Card Products)

| 鎿嶄綔 | 绔偣 | 鏂规硶 |
|------|------|------|
| 鍒楀嚭鍗′骇鍝?| `/api/v1/issuing/products?page_size=100&page_number=1` | GET |

杩斿洖姣忎釜浜у搧鐨?`id`锛堝嵆 `card_product_id`锛夛紝鏄垱寤哄崱鐗囩殑蹇呴渶鍙傛暟銆?

**SDK 鏂规硶**锛?
```ts
// 鑷姩鏌ユ壘 USD 鍙敤浜у搧
const productId = await sdk.getCardProductId('USD');
```

---

### 3.3 鍗＄墖绠＄悊 (Cards)

| 鎿嶄綔 | 绔偣 | 鏂规硶 |
|------|------|------|
| 鍒涘缓鍗＄墖 | `/api/v1/issuing/cards` | POST |
| 鑾峰彇鍗＄墖璇︽儏 | `/api/v1/issuing/cards/{id}` | GET |
| 鏇存柊鍗＄墖鐘舵€?| `/api/v1/issuing/cards/{id}` | POST |
| 鍒楀嚭鎵€鏈夊崱鐗?| `/api/v1/issuing/cards` | GET |

**鍗＄墖鐘舵€佹灇涓?*锛?
- `PENDING` - 寰呭鐞?
- `ACTIVE` - 婵€娲?
- `FROZEN` - 鍐荤粨
- `BLOCKED` - 宸插皝閿?
- `CANCELLED` - 宸插彇娑?
- `LOST` - 鎸傚け
- `STOLEN` - 琚洍
- `FAILED` - 澶辫触

**鍒涘缓鍗＄墖璇锋眰浣?*锛?
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

**鏇存柊鍗＄墖鐘舵€侊紙鍐荤粨/瑙ｅ喕/鍙栨秷锛?*锛?
```json
{
  "card_status": "FROZEN"
}
```

**SDK 鏂规硶**锛?
```ts
// 鍒涘缓鍗?
const card = await sdk.createCard({
  cardholderId: cardholderId,
  cardProductId: productId,
  cardCurrency: 'USD',
  cardLimit: 1000,
  cardType: 'virtual',
});

// 鍐荤粨
await sdk.freezeCard(cardId);

// 瑙ｅ喕
await sdk.unfreezeCard(cardId);

// 鍙栨秷
await sdk.cancelCard(cardId);
```

> 鈿狅笍 **PCI DSS 鍚堣**: UQPay API 閫氬父涓嶅湪鍒涘缓鍝嶅簲涓繑鍥炴槑鏂囧崱鍙?CVV銆傚畬鏁村崱闈俊鎭渶浠?UQPay Dashboard 鑾峰彇鎴栭€氳繃 Webhook 鎺ユ敹銆?

---

### 3.4 杞处 (Transfer) 鈥?閽卞寘鍏呭€?

| 鎿嶄綔 | 绔偣 | 鏂规硶 |
|------|------|------|
| 鍒涘缓杞处 | `/api/v1/transfer` | POST |
| 杞处鍒楄〃 | `/api/v1/transfer` | GET |

**鍏呭€兼祦绋?*锛?
1. 鐢ㄦ埛鍚戝钩鍙板湪 UQPay 鐨勯挶鍖呭湴鍧€杞处 USDT
2. 骞冲彴鐩戝惉閾句笂鍒拌处锛堥€氳繃 Webhook 鎴栬疆璇級
3. 纭鍚庤皟鐢?Transfer API 灏嗚祫閲戣浆鍏ュ彂鍗¤处鎴?

**鍒涘缓杞处璇锋眰浣?*锛?
```json
{
  "source_account_id": "<骞冲彴璐︽埛ID>",
  "target_account_id": "<鎸佸崱浜鸿处鎴稩D>",
  "currency": "USD",
  "amount": "100.00",
  "reason": "Card wallet top-up"
}
```

**SDK 鏂规硶**锛?
```ts
const transfer = await sdk.transferToCard(
  sourceAccountId,
  targetAccountId,
  100,
  'USD'
);
```

---

## 4. 娓犻亾閰嶇疆 (card_channels 琛?

鍦?`card_channels` 琛ㄤ腑閰嶇疆 UQPay 娓犻亾锛?

```sql
INSERT INTO card_channels
  (channel_code, channel_name, api_base_url, api_key, api_secret, status, config_json)
VALUES
  ('UQPAY', 'UQPay 鍙戝崱', 'https://api-sandbox.uqpaytech.com', '<client_id>', '<api_key>', 1,
   '{"clientId":"<client_id>","apiSecret":"<api_secret>","depositAddresses":{"trx":"TRC20鍦板潃","eth":"ERC20鍦板潃","bnb":"BEP20鍦板潃"}}');
```

### config_json 瀛楁璇存槑

| 瀛楁 | 璇存槑 |
|------|------|
| `clientId` | UQPay Client ID锛堝彲鏇夸唬 api_key锛?|
| `apiSecret` | UQPay API Secret锛堝彲鏇夸唬 api_secret锛?|
| `depositAddresses.trx` | 骞冲彴 TRC20 USDT 鍏呭€煎湴鍧€ |
| `depositAddresses.eth` | 骞冲彴 ERC20 USDT 鍏呭€煎湴鍧€ |
| `depositAddresses.bnb` | 骞冲彴 BEP20 USDT 鍏呭€煎湴鍧€ |

---

## 5. 鏁版嵁搴撳瓧娈靛彉鏇?

```sql
-- cards 琛ㄦ柊澧?channel_code 瀛楁
ALTER TABLE cards ADD COLUMN channel_code VARCHAR(20) DEFAULT 'MOCK';

-- usdt_orders 琛ㄦ柊澧?uqpay_order_id 瀛楁
ALTER TABLE usdt_orders ADD COLUMN uqpay_order_id VARCHAR(100);
```

---

## 6. 鎺ュ彛璺敱鏄犲皠

| 鍔熻兘 | 璺敱 | 鏂规硶 |
|------|------|------|
| 鑾峰彇鍏呭€煎湴鍧€ | `GET /api/v1/wallet/address` | UQPay 鈫?getDepositAddress |
| 鍒涘缓鍏呭€艰鍗?| `POST /api/v1/wallet/deposit/c2c` | UQPay 鈫?createC2COrder |
| 鍒涘缓鍗＄墖 | `POST /api/v1/cards` | UQPay 鈫?getOrCreateCardholder + createCard |
| 鍐荤粨鍗＄墖 | `POST /api/v1/cards/:id/freeze` | UQPay 鈫?freezeCard |
| 瑙ｅ喕鍗＄墖 | `POST /api/v1/cards/:id/unfreeze` | UQPay 鈫?unfreezeCard |
| 娉ㄩ攢鍗＄墖 | `POST /api/v1/cards/:id/cancel` | UQPay 鈫?cancelCard |
| 鏌ョ湅鍗￠潰 | `GET /api/v1/cards/:id/reveal` | 杩斿洖鎻愮ず锛堟槑鏂囦粠 Dashboard 鑾峰彇锛墊

---

## 7. 娓犻亾浼樺厛绾?

绯荤粺鏀寔澶氭笭閬撹嚜鍔ㄥ垏鎹紝浼樺厛绾э細

1. **UQPAY** 鈥?鏈€楂樹紭鍏堢骇锛宍channel_code = 'UQPAY'` 涓?`status = 1`
2. **DogPay** 鈥?澶囬€夋笭閬擄紝`channel_code = 'dogpay'` 涓?`status = 1`
3. **Mock** 鈥?鏃犳笭閬撴椂闄嶇骇锛屾湰鍦扮敓鎴愬亣鍗℃暟鎹紙浠呮祴璇曠敤锛?

---

## 8. Webhook 閰嶇疆锛堝缓璁級

寤鸿閰嶇疆 UQPay Webhook 鎺ユ敹浠ヤ笅浜嬩欢锛?

| 浜嬩欢 | 璇存槑 |
|------|------|
| `card.created` | 鏂板崱鍒涘缓鎴愬姛 |
| `card.status_changed` | 鍗＄墖鐘舵€佸彉鏇达紙鍐荤粨/瑙ｅ喕/鍙栨秷锛?|
| `transfer.completed` | 杞处瀹屾垚锛堝厖鍊肩‘璁わ級 |
| `card.transaction` | 鍗＄墖娑堣垂/閫€娆鹃€氱煡 |

Webhook 鍦板潃锛歚POST /api/v1/webhooks/uqpay`

---

## 9. 娌欑娴嬭瘯璐﹀彿鐢宠

1. 鐧诲綍 UQPay 寮€鍙戣€呭钩鍙?
2. 杩涘叆銆孉PI Keys銆嶉〉闈㈢敓鎴?`client_id` 鍜?`api_key`
3. 鍦?Dashboard 鐢宠鍙戝崱璐︽埛鏉冮檺
4. 閰嶇疆娴嬭瘯鍗′骇鍝侊紙Sandbox 鐜涓嬪崱浜у搧 ID 涓嶅悓锛?

---

## 10. 甯歌闂

**Q: 鍒涘缓鎸佸崱浜哄け璐ワ紙400/401锛夛紵**
A: 妫€鏌?`x-client-id` 鍜?`x-api-key` 鏄惁姝ｇ‘锛岀‘璁よ处鎴峰凡寮€閫氬彂鍗℃潈闄愩€?

**Q: 鍗′骇鍝?ID 濡備綍鑾峰彇锛?*
A: 璋冪敤 `GET /api/v1/issuing/products` 鍒楀嚭鍙敤浜у搧銆?

**Q: 鍏呭€煎湴鍧€涓嶈繑鍥烇紵**
A: 纭 `card_channels.config_json` 涓凡閰嶇疆 `depositAddresses` 瀵硅薄銆?

**Q: 鏄庢枃鍗″彿/CVV 鏃犳硶鑾峰彇锛?*
A: 杩欐槸 UQPay 鐨?PCI DSS 瀹夊叏璁捐銆傛槑鏂囦俊鎭彧鑳戒粠 UQPay Dashboard 鏌ョ湅锛屾垨閫氳繃 Webhook 鎺ユ敹銆?

**Q: 濡備綍浠?DogPay 鍒囨崲鍒?UQPay锛?*
A: 灏?`card_channels` 涓?DogPay 璁板綍 `status = 0`锛屾坊鍔?UQPay 璁板綍 `status = 1`锛岄噸鍚湇鍔″嵆鍙嚜鍔ㄥ垏鎹€?
