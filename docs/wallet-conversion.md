# USDT → USD 钱包兑换功能

> 分支：`fix/wallet-usdt-to-usd-conversion`
> PR #46

---

## 1. balance_usdt 与 balance_usd 的区别

`wallets` 表有两个余额字段，**不是新旧字段关系**，而是**币种隔离设计**：

| 字段 | 币种 | 用途 | 操作方 |
|------|------|------|--------|
| `balance_usd` | USD | **平台信用余额**：卡片充值扣款、UQPay 充值扣款、管理员 USD 调账 | cards.ts, uqpay-recharge.ts, admin-wallet.ts |
| `balance_usdt` | USDT | **稳定币余额**：CoinPal/CoinPay 链上充值入账 | coinpal-webhook.ts, coinpay-webhook.ts |
| `locked_usd` | USD | 锁定金额（预留） | — |

**核心约束：严禁跨字段读写！**

- 查询用户余额给卡片充值时，必须查 `balance_usd`
- 查询 USDT 充值余额时，必须查 `balance_usdt`
- 前端 Wallet.tsx 和后台 WalletManagement.tsx 分别展示两个余额

详细说明见 `docs/wallet-balance-fields.md`。

---

## 2. USDT → USD 兑换流程

```
用户发起兑换
    │
    ▼
POST /api/v1/wallet/convert/usdt-to-usd
    │
    ├─ 1. 功能开关检查（ENABLE_WALLET_CONVERT）
    ├─ 2. 灰度白名单检查（WALLET_CONVERT_TEST_USER_IDS）
    ├─ 3. 参数校验（amount_usdt > 0）
    ├─ 4. 幂等键检查（Idempotency-Key）
    ├─ 5. 读取汇率（USDT_TO_USD_RATE）
    │
    ▼
BEGIN TRANSACTION
    │
    ├─ 6. 读取钱包（balance_usdt / balance_usd）
    ├─ 7. 检查 balance_usdt >= amount_usdt
    ├─ 8. UPDATE wallets SET balance_usdt -= N, balance_usd += N*rate
    ├─ 9. INSERT INTO wallet_conversions（兑换记录）
    ├─ 10. INSERT INTO wallet_records（CONVERT_OUT: USDT扣减）
    ├─ 11. INSERT INTO wallet_records（CONVERT_IN: USD增加）
    │
    ▼
COMMIT → 返回成功结果
```

---

## 3. 环境变量说明

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ENABLE_WALLET_CONVERT` | `false` | 功能开关，默认关闭。设为 `true` 启用 |
| `WALLET_CONVERT_TEST_USER_IDS` | `2,13` | 灰度测试用户 ID（逗号分隔）。留空表示所有人可用 |
| `USDT_TO_USD_RATE` | `1.0` | 兑换汇率。例如 `0.99` 表示 1 USDT = 0.99 USD |
| `USDT_TO_USD_FEE_RATE` | `0` | 兑换手续费率（预留，当前未实现） |
| `USDT_TO_USD_MIN_AMOUNT` | `1` | 单笔最小兑换数量（预留，当前未实现） |
| `USDT_TO_USD_MAX_AMOUNT` | `10000` | 单笔最大兑换数量（预留，当前未实现） |

---

## 4. 白名单机制

```typescript
// server/src/routes/client-wallet.ts
const testUserIds = (process.env.WALLET_CONVERT_TEST_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (testUserIds.length > 0 && !testUserIds.includes(String(userId))) {
  return res.json({ code: 403, message: '您暂时无法使用兑换功能' });
}
```

- 当 `WALLET_CONVERT_TEST_USER_IDS` 为空时，**所有用户可用**（需 `ENABLE_WALLET_CONVERT=true`）
- 当 `WALLET_CONVERT_TEST_USER_IDS` 有值时，**仅列表中的用户可用**
- 结合 `ENABLE_WALLET_CONVERT=false`，线上默认完全关闭，零风险

---

## 5. 幂等设计

**双重幂等保护：**

```
Idempotency-Key Header（由客户端主动提供）
    │
    ▼
服务端检查 wallet_conversions.idempotency_key
    │
    ├─ 已存在 → 返回已处理结果（幂等响应）
    └─ 不存在 → 执行兑换（原子事务保证）
```

- 客户端可选传 `Idempotency-Key` Header（UUID v4 推荐，最长 64 字符）
- 未传时服务端自动生成 `convert-{userId}-{timestamp}-{random}` 作为幂等键
- 幂等键在 `wallet_conversions.idempotency_key` 上有 **UNIQUE 约束**，数据库层面防止重复
- 重复请求返回 `code: 0` + 已有结果（非 409），方便前端统一处理

---

## 6. wallet_conversions 表结构

```sql
CREATE TABLE IF NOT EXISTS wallet_conversions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            INTEGER NOT NULL,
    amount_usdt        REAL NOT NULL,         -- USDT 扣减额
    amount_usd         REAL NOT NULL,          -- USD 增加额
    rate               REAL NOT NULL DEFAULT 1.0,  -- 兑换汇率
    balance_usdt_before REAL NOT NULL,        -- USDT 变动前余额
    balance_usdt_after  REAL NOT NULL,        -- USDT 变动后余额
    balance_usd_before  REAL NOT NULL,        -- USD 变动前余额
    balance_usd_after   REAL NOT NULL,        -- USD 变动后余额
    idempotency_key    VARCHAR(64) UNIQUE,    -- 幂等键
    remark             VARCHAR(200),
    status             VARCHAR(20) DEFAULT 'COMPLETED',  -- COMPLETED / FAILED
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

索引：
- `idx_wallet_conversions_user_id`：按用户查询
- `idx_wallet_conversions_key`：按幂等键查询

---

## 7. wallet_records 流水说明

一次兑换产生 **2 条流水记录**，通过 `reference_id` 关联到同一 `wallet_conversions.id`：

### 记录 1：USDT 扣减

| 字段 | 值 |
|------|-----|
| `type` | `CONVERT_OUT` |
| `amount` | **负数**（如 `-100`） |
| `currency` | `USDT` |
| `balance_before` | 兑换前 USDT 余额 |
| `balance_after` | 兑换后 USDT 余额 |
| `reference_type` | `wallet_conversion` |
| `remark` | `USDT→USD 兑换：扣除 100 USDT` |

### 记录 2：USD 增加

| 字段 | 值 |
|------|-----|
| `type` | `CONVERT_IN` |
| `amount` | **正数**（如 `100`） |
| `currency` | `USD` |
| `balance_before` | 兑换前 USD 余额 |
| `balance_after` | 兑换后 USD 余额 |
| `reference_type` | `wallet_conversion` |
| `remark` | `USDT→USD 兑换：增加 100 USD` |

---

## 8. 前端入口说明

**文件**：`client/src/pages/Wallet.tsx`

**UI 位置**：余额卡片上方，标题行右侧

```
┌──────────────────────────────────────────────────┐
│  💰 我的钱包                    [兑换 USD] [充值 USDT] │
├──────────────────────────────────────────────────┤
│  USD 余额: $0.00     USDT 余额: ₮0.00            │
├──────────────────────────────────────────────────┤
│  USDT→USD 兑换记录                               │
│  扣减 USDT | 增加 USD | 汇率 | 状态 | 时间        │
├──────────────────────────────────────────────────┤
│  充值记录                                        │
│  ...                                            │
└──────────────────────────────────────────────────┘
```

**兑换流程**：
1. 点击「兑换 USD」按钮 → 弹出模态框
2. 输入 USDT 数量 → 实时显示预计 USD（`amount * rate`）
3. 点击「立即兑换」→ 等待结果
4. 成功页展示：USDT 扣减、USD 增加、变动前后所有余额
5. 兑换记录表格自动刷新

---

## 9. 后台记录查看说明

**文件**：`admin/src/pages/WalletManagement.tsx`

**位置**：在商户详情弹窗中，调整记录表下方

```
┌──────────────────────────────────────────────┐
│  商户编号: xxx     USD余额: $100    USDT: ₮50  │
├──────────────────────────────────────────────┤
│  调整记录                                      │
│  ...                                          │
├──────────────────────────────────────────────┤
│  🔄 兑换记录                                   │
│  USDT扣减 | USD增加 | 汇率 | USDT变动前后 |     │
│  USD变动前后 | 状态 | 时间                      │
│  ...                                          │
└──────────────────────────────────────────────┘
```

**API**：`GET /api/admin/wallet/conversions/:userId`（分页）

---

## 10. 测试清单

### 前置条件
- [ ] 服务器 `.env` 设置 `ENABLE_WALLET_CONVERT=true`
- [ ] 服务器 `.env` 设置 `WALLET_CONVERT_TEST_USER_IDS=2`（自己测试）
- [ ] 重启 PM2：`pm2 restart vcc-server`
- [ ] 前端重新构建部署

### 功能测试
- [ ] 兑换按钮可见
- [ ] 输入 10 USDT → 显示预计 $10.00
- [ ] 确认兑换 → 返回成功（USDT -10, USD +10）
- [ ] 钱包余额即时刷新
- [ ] 兑换记录表格更新
- [ ] 后台详情弹窗可见兑换记录

### 边界测试
- [ ] 输入 0 → 400 错误
- [ ] 输入负数 → 400 错误
- [ ] 输入超过 USDT 余额 → 400 USDT 余额不足
- [ ] 连续快速点击 → 幂等保护，只生效一次

### 权限测试
- [ ] `ENABLE_WALLET_CONVERT=false` → 403 功能未开放
- [ ] 不在白名单的用户 → 403 无法使用
- [ ] 未登录 → 401 未登录

### 回滚测试
- [ ] 事务中模拟余额不足 → ROLLBACK，余额不变
- [ ] 事务中模拟数据库异常 → ROLLBACK，余额不变

---

## 11. 上线注意事项

### 灰度步骤
1. **第一阶段（代码合并）**：合并 PR，`ENABLE_WALLET_CONVERT=false`（默认关闭）
2. **第二阶段（灰度测试）**：修改服务器 `.env`，`ENABLE_WALLET_CONVERT=true`，`WALLET_CONVERT_TEST_USER_IDS=2`，重启 PM2
3. **第三阶段（全量开放）**：清空 `WALLET_CONVERT_TEST_USER_IDS`，所有用户可用
4. **第四阶段（稳定运行）**：根据运营数据调整汇率和限额

### 风险控制
- 默认关闭，零影响
- 灰度白名单控制影响范围
- 幂等键防止重复扣款
- 原子事务保证数据一致性
- 可随时关闭：`ENABLE_WALLET_CONVERT=false` + `pm2 restart vcc-server`

### 监控
- 关注 `wallet_records` 中 `CONVERT_OUT`/`CONVERT_IN` 的占比
- 关注 `wallet_conversions` 表的增长量
- 关注前端兑换失败率

---
