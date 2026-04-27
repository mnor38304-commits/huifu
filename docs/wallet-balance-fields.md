# 钱包余额字段说明

## 背景

`wallets` 表包含两个独立的余额字段和⼀个锁定字段，分别记录不同币种的余额。**它们不是新旧字段关系，而是币种隔离设计。**

## 字段定义

| 字段 | 类型 | 默认值 | 用途 |
|------|------|--------|------|
| `balance_usd` | `REAL` | 0 | **USD 平台信用余额**：卡片充值、UQPay 充值扣款、管理员 USD 调账 |
| `balance_usdt` | `REAL` | 0 | **USDT 稳定币余额**：CoinPal/CoinPay 链上充值入账、USDT 余额展示 |
| `locked_usd` | `REAL` | 0 | **锁定金额**：预留字段 |

## 业务映射

### `balance_usd` — USD 平台信用余额

- **卡片充值**（`server/src/routes/cards.ts`）：充值前检查 `wallet.balance_usd >= amount`，扣除时 `UPDATE wallets SET balance_usd = balance_usd - amount`
- **UQPay 卡充值**（`server/src/services/uqpay-recharge.ts`）：充值前检查 `wallet.balance_usd >= amount`，扣除时 `UPDATE wallets SET balance_usd = balance_usd - amount`
- **UQPay 充值失败回滚**（同上）：回滚时 `UPDATE wallets SET balance_usd = balance_usd + amount`
- **管理员调账**（`server/src/routes/admin-wallet.ts`）：增/减操作均更新 `balance_usd`
- **钱包创建**：`INSERT INTO wallets (...) VALUES (..., balance_usd=0, ...)`

### `balance_usdt` — USDT 稳定币余额

- **CoinPal 充值到账**（`server/src/routes/coinpal-webhook.ts`）：`UPDATE wallets SET balance_usdt = balance_usdt + creditAmount`
- **CoinPay 充值到账**（`server/src/routes/coinpay-webhook.ts`）：`UPDATE wallets SET balance_usdt = balance_usdt + creditAmount`
- **Client-wallet CoinPal 主动查询到账**（`server/src/routes/client-wallet.ts`）：`UPDATE wallets SET balance_usdt = balance_usdt + creditAmount`
- **USDT 流水记录**：`wallet_records` 表中 `currency='USDT'`，`type='TOPUP'`

### `locked_usd` — 锁定金额

- 预留字段，当前未使用的锁定逻辑

## 前端展示

### 商户前台（`client/src/pages/Wallet.tsx`）

钱包页同时展示两个余额卡片：

```tsx
<Statistic title="USD 余额" value={wallet?.balance_usd || 0} prefix="$" />
<Statistic title="USDT 余额" value={wallet?.balance_usdt || 0} prefix="₮" />
```

API 来源：`GET /api/wallet/info` 返回 `SELECT * FROM wallets WHERE user_id = ?` 的全部字段。

### 管理后台（`admin/src/pages/WalletManagement.tsx`）

表格列和详情面板均分别展示 USD 余额和 USDT 余额：

```tsx
{ title: 'USD余额', dataIndex: 'balance_usd' }
{ title: 'USDT余额', dataIndex: 'balance_usdt' }
```

仪表盘合计也分别统计：`SUM(balance_usd) as total`、`SUM(balance_usdt) as totalUsdt`。

## 核心约束

### 1. 不要跨字段读写

所有的 USD 操作（卡充值、UQPay 充值、管理员调账）**只读/写 `balance_usd`**。

所有的 USDT 操作（CoinPal/CoinPay 入账）**只读/写 `balance_usdt`**。

当前全项目不存在"一处写 `balance_usd`、另一处读 `balance_usdt`"的跨字段操作。

### 2. USD 与 USDT 之间不做自动转换

> 代码注释原文：`// 假设：1 USDT = 1 USD，本轮不做汇率转换`

当前 USD 和 USDT 是两个隔离的余额池：

- 用户通过 CoinPal 充值 USDT → 增加 `balance_usdt`
- 用户给卡片充值 → 检查并扣除 `balance_usd`
- **用户有 USDT 余额并不能直接用给卡片充值**，因为卡充值只检查 `balance_usd`

### 3. ⚠️ 常见误操作

**错误：** 查询 `balance_usdt` 来判断用户是否有钱给卡片充值。  
**正确：** 卡片充值应查询 `balance_usd`。USDT 是独立币种，不代表充值到卡片的可用额度。

## 如果需要打通 USDT → USD

如果业务需要允许用户将 USDT 余额用于卡片充值，**不应直接读取/写入对方的字段**，而应实现 USDT → USD 兑换/划转流程：

1. 在 `wallets` 表中或通过 `wallet_records` 记录兑换流水
2. 事务中：`balance_usdt - amount` & `balance_usd + amount`（或反向）
3. 可参考 `usdt_orders` 表的 `exchange_rate` + `amount_usd` 字段处理汇率

**在当前架构下，切勿直接在一笔操作中同时写入两个字段的余额而不经过兑换流水记录。**
