# UQPay + 钱包兑换阶段性上线归档报告

> 归档日期：2026-04-28
> 对应 PR：#45, #48, #49
> 当前生产 HEAD：`e2b63bc`

---

## 1. 已完成模块

### 1.1 UQPay 核心集成

| 模块 | 说明 | 状态 |
|------|------|------|
| Token 认证 | SDK 自动管理 x-client-id / x-api-key → x-auth-token 生命周期 | ✅ |
| Cardholder 管理 | 创建/查询 Cardholder，phone_number 不带 + 前缀 | ✅ |
| Card Products 查询 | product_id / card_currency / card_scheme / mode_type 解析 | ✅ |
| 开卡 (Create Card) | 支持 UQPay 沙箱发卡，记录 external_id | ✅ |
| PAN Secure iFrame | 前端 iFrame 展示 PAN，后端不存储明文 | ✅ |
| Health 检查 | `/health` 端点连通性验证 | ✅ |
| Issuing Balance 查询 | `GET /api/v1/issuing/balances` | ✅ |

### 1.2 UQPay 用户端真实充值

- 完整事务流程：校验 → 幂等/并发检查 → 扣钱包 → 写流水 → 写订单 → SDK 调用 → 结果处理
- `ENABLE_UQPAY_REAL_RECHARGE` + `UQPAY_RECHARGE_TEST_USER_IDS` 双层保护
- 充值订单表 `uqpay_recharge_orders`：PENDING / SUCCESS / FAILED / REFUNDED / CANCELLED
- 充值后同步卡片余额（优先 `card_available_balance`，其次 `balance_after`，最后主动查询）
- 失败时回滚钱包余额 + 写退款流水

### 1.3 Webhook 处理

| Webhook 类型 | 处理逻辑 | 状态 |
|-------------|----------|------|
| `card.recharge.succeeded` | 匹配订单（3 种策略）→ 标记 SUCCESS → 同步余额 | ✅ |
| `card.recharge.failed` | 匹配订单 → 标记 FAILED → 回滚钱包 | ✅ |
| `card.issuing.fee.card` | 仅记录日志，不处理资金 | ✅ |
| `payload=null` | `extractWebhookPayload()` 多层兜底提取，null 时返回 IGNORED | ✅ |

**订单匹配策略（3 种）**：
1. `card_order_id` 精确匹配
2. `unique_request_id` 精确匹配（幂等 key）
3. `card_id + amount + 30 分钟时间窗口` 兜底

### 1.4 Reconcile 补偿机制

- `reconcileRechargeOrder(orderId)`：主动查询 UQPay 侧卡状态 + 余额对比
- 判定逻辑：余额变化 ≈ 订单金额 → SUCCESS / 卡不存在/已取消 → FAILED / 金额不匹配 → UNKNOWN
- `reconcilePendingOrders(maxOrders, minAgeMinutes)`：批量扫描 PENDING/UNKNOWN
- 管理员 API：单条 + 批量 reconcile 端点
- CLI 扫描脚本：`scripts/scan-reconcile.ts`

### 1.5 真实充值开关 + 白名单

```
ENABLE_UQPAY_REAL_RECHARGE=false         # 全局开关
UQPAY_RECHARGE_TEST_USER_IDS=2,13       # 白名单用户
```

- 开关关闭 → 用户端充值返回 400 "UQPay 真实充值暂未开放"
- 开关打开但用户不在白名单 → 返回 403

### 1.6 USDT → USD 钱包兑换

- `POST /api/v1/wallet/convert/usdt-to-usd`
- 扣减 `balance_usdt` + 增加 `balance_usd`（原子事务）
- 幂等支持：`Idempotency-Key` Header + 服务端自动生成 fallback
- 流水类型：`CONVERT_OUT`（USDT 扣减）+ `CONVERT_IN`（USD 增加）
- 记录表：`wallet_conversions`（含转换前后余额快照 + 幂等 key）

### 1.7 钱包字段说明

参见 `docs/wallet-balance-fields.md`，核心：

| 字段 | 用途 | 操作方 |
|------|------|--------|
| `balance_usd` | USD 平台信用余额 | 卡片充值、UQPay 充值扣款、管理员 USD 调账 |
| `balance_usdt` | USDT 稳定币余额 | CoinPal/CoinPay 链上充值入账 |
| `locked_usd` | 锁定金额（预留） | - |

### 1.8 管理员审计字段

PR #49 新增（2026-04-28 已上线）：

| 字段 | 表 | 类型 | 用途 |
|------|----|------|------|
| `admin_user_id` | `uqpay_recharge_orders` | INTEGER | 执行 reconcile/操作的管理员 ID |
| `audit_remark` | `uqpay_recharge_orders` | TEXT | 操作备注/原因 |

写入路径：
- 管理员单条 reconcile → `reconcileRechargeOrder(orderId, adminId, remark)`
- 管理员批量 reconcile → `reconcilePendingOrders(max, min, adminId, remark)`
- 管理员充值失败 → `markRechargedFailed(orderId, ..., adminId, '管理员充值：UQPay 拒绝请求')`
- reconcile 中卡不存在/已取消 → 级联传递 `adminUserId + auditRemark`

### 1.9 deploy.sh 持久化

- 部署脚本 `deploy.sh`（6 步流程）：git pull → server build → client build → admin build → 同步 Nginx → PM2 restart + Nginx reload
- 已合并到 main，`.gitattributes` 强制 LF 换行符
- 用法：`bash /opt/huifu/deploy.sh [branch]`

### 1.10 临时文件清理

- 本地开发脚本：`diag-uqpay-v2.ts`、`select-active-uqpay-cards.ts`、`run-wallet-convert-tests.ts`、`seed-test-user.ts`、`test-runner-http.ts`、`wallet-convert-integration-test.ts`、`start-test-server.cmd`、`start-test-server.ps1`
- 服务器端临时文件：`/tmp/check-db-fields.js`、`/tmp/check.sql` 等

---

## 2. 当前生产开关

```
ENABLE_UQPAY_REAL_RECHARGE=false
UQPAY_RECHARGE_TEST_USER_IDS=2,13

ENABLE_WALLET_CONVERT=false
WALLET_CONVERT_TEST_USER_IDS=13,2
USDT_TO_USD_RATE=1.0
```

| 开关 | 值 | 说明 |
|------|-----|------|
| `ENABLE_UQPAY_REAL_RECHARGE` | `false` | 用户端 UQPay 真实充值默认关闭 |
| `UQPAY_RECHARGE_TEST_USER_IDS` | `2,13` | 充值白名单用户 |
| `ENABLE_WALLET_CONVERT` | `false` | 钱包 USDT→USD 兑换默认关闭 |
| `WALLET_CONVERT_TEST_USER_IDS` | `13,2` | 兑换白名单用户 |
| `USDT_TO_USD_RATE` | `1.0` | 兑换汇率（暂固定 1:1） |

---

## 3. 已验证链路

### 3.1 USDT → USD 兑换（2026-04-27 22:43）

| 步骤 | 结果 |
|------|------|
| 临时开启 + 白名单 | ✅ |
| user_id=13, 1 USDT → 1 USD | ✅ code=0, balance_usdt: 101→100, balance_usd: 89→90 |
| `wallet_conversions` 记录 | ✅ 1 条 |
| `wallet_records` 流水 (CONVERT_OUT + CONVERT_IN) | ✅ 2 条 |
| 幂等测试：重复 Idempotency-Key | ✅ "该订单已处理" |
| 关闭开关后重试 | ✅ 403 |
| 集成测试 18/18 | ✅ 全部通过 |
| 生产 16 项验证 | ✅ 全部通过 |

### 3.2 UQPay 用户端 1 USD 充值（2026-04-27 23:12-23:16）

| 步骤 | 结果 |
|------|------|
| 预检：user_id=13 卡不存在 → 改用 user_id=2 | ✅ |
| 临时开启 + 白名单 | ✅ |
| POST /api/v1/cards/1/topup amount=1 | ✅ code=0, orderId=5, orderStatus=PENDING |
| wallet.balance_usd: 5→4 | ✅ 即时扣减 |
| 流水 CARD_TOPUP, amount=-1 | ✅ |
| 7 秒后 webhook 到达 SUCCESS | ✅ |
| 本地 cards.balance: 103 | ✅ |
| 关闭开关后重试 | ✅ 400 "暂未开放" |

### 3.3 Webhook SUCCESS 回调

- `card.recharge.succeeded` 正确匹配订单（策略 C: card_id+amount+时间窗口）
- 订单状态更新为 SUCCESS
- 卡片余额同步
- 已终态订单不重复处理

### 3.4 PENDING / FAILED / Reconcile 安全路径

- PENDING 的 reconcile: 卡存在且余额匹配 → SUCCESS / 卡不存在或已取消 → FAILED + 回滚
- 已终态（SUCCESS/FAILED/REFUNDED/CANCELLED）直接跳过
- WHERE `status IN ('PENDING', 'UNKNOWN')` 保证不重复变更

### 3.5 开关关闭后拦截

- `ENABLE_UQPAY_REAL_RECHARGE=false` → 充值返回 400
- `ENABLE_WALLET_CONVERT=false` → 兑换返回 403
- 白名单外用户即使在开启状态也返回 403

### 3.6 敏感信息过滤

- 不存储 PAN / CVV
- 日志中不输出 token / clientId / apiKey
- `uqpay_response` 字段限制 4000 字符
- `error_message` / `audit_remark` 限制 500 字符
- PAN 前端 iFrame 隔离，后端仅存 `card_no_masked`

---

## 4. 账务字段

### 4.1 `wallets` 表余额字段

参见 `docs/wallet-balance-fields.md`

| 字段 | 用途 | 操作场景 |
|------|------|----------|
| `balance_usd` | USD 平台信用余额 | 卡片充值扣款、UQPay 充值扣款、管理员 USD 调账、钱包兑换入账（USDT→USD） |
| `balance_usdt` | USDT 稳定币余额 | CoinPal 链上充值入账、CoinPay 链上充值入账、钱包兑换出账（USDT→USD） |
| `locked_usd` | 锁定金额（预留） | 当前未使用 |

### 4.2 资金流向

```
用户 USDT 充值 (CoinPal/CoinPay)
    ↓
balance_usdt 增加
    ↓
钱包兑换 (/api/v1/wallet/convert/usdt-to-usd)
    ↓
balance_usdt 减少 → balance_usd 增加
    ↓
UQPay 卡片充值 (/api/v1/cards/:id/topup)
    ↓
balance_usd 减少 → 卡片余额增加
```

---

## 5. 当前风险与限制

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| UQPay 沙箱部分订单可能 PENDING | 沙箱异步处理，充值返回 PENDING 后需等 webhook | reconcile 补偿机制扫描处理 |
| `payload=null` 无法结算 | 已安全返回 IGNORED，但订单永久 PENDING | 需人工 reconcile 介入 |
| 用户端真实充值默认关闭 | 上线初期防止误操作 | ENABLE_UQPAY_REAL_RECHARGE=false 强制关闭 |
| 钱包兑换默认关闭 | 防止未授权兑换 | ENABLE_WALLET_CONVERT=false 强制关闭 |
| 缺少灰度限额/日限额 | 无单笔/每日充值上限 | 下一批 PR 补充 |
| 缺少告警机制 | PENDING/UNKNOWN 订单无自动通知 | 下一批 PR 补充 |
| `card_order_id` 审计字段 | PR #49 已添加，持续观察写入效果 | 下一批 PR 可补充查询视图 |
| USDT→USD 汇率固定 1:1 | 未对接真实汇率源 | 当前阶段可接受，后续可配置 |
| user_id=13 无 ACTIVE 卡 | 无法做同用户完整充值链路测试 | 建议后续在 UQPay 沙箱为该用户开卡 |

---

## 6. 推荐灰度流程

```
阶段 1：仅 user_id=2,13（✅ 已完成）
├── UQPay 充值：user_id=2 沙箱测试通过
└── 钱包兑换：user_id=13 沙箱测试通过

阶段 2：新增 1-2 个内部用户（建议下一批）
├── 创建 UQPay 沙箱卡片
├── UQPay 充值白名单测试
├── 钱包兑换白名单测试
└── 验证跨用户无数据泄露

阶段 3：小额真实用户
├── 开通 ENABLE_UQPAY_REAL_RECHARGE（全部用户）
├── 设置单笔/日累计限额
├── 配置 PENDING 告警
├── 启用 reconcile crontab（每 15 分钟）
└── 观察 24-48 小时日志

阶段 4：扩大开放
├── 逐步提高限额
├── 开通 ENABLE_WALLET_CONVERT
├── 对接真实汇率
└── 全量用户可用
```

---

## 7. 上线前必须保持

> **运维检查清单（每日）**

- [ ] `ENABLE_UQPAY_REAL_RECHARGE=false` — 不打开全量真实充值
- [ ] `ENABLE_WALLET_CONVERT=false` — 不打开全量钱包兑换
- [ ] 每次测试后 **必须** 关闭上述开关并 `pm2 restart vcc-server --update-env`
- [ ] 每天检查 `uqpay_recharge_orders` 中 PENDING / UNKNOWN 订单
- [ ] 定期检查 PM2 日志：`pm2 logs vcc-server --lines 50 --nostream`
- [ ] 定期检查 Nginx 访问日志：`tail -50 /var/log/nginx/access.log`
- [ ] 定期检查 webhook 处理日志（关键字：`NEEDS_RECONCILE`、`payload null`）
- [ ] 数据库备份 crontab 正常：`/opt/backups/backup_vcc_db.sh`（每天 02:00）
- [ ] 证书自动续期正常：`certbot.timer`
- [ ] 磁盘使用率 < 80%

---

## 8. 建议下一批 PR

| 优先级 | PR 内容 | 说明 |
|--------|---------|------|
| P0 | UQPay 单笔/日累计限额 | 充值上限控制，防止异常大额充值 |
| P0 | PENDING/UNKNOWN 告警 | 订单长时间 PENDING 自动通知管理员 |
| P1 | Reconcile 定时任务 crontab | 每 15 分钟自动扫描 PENDING 订单 |
| P1 | 管理后台订单筛选与导出 | 按状态/用户/时间筛选 + CSV/Excel 导出 |
| P2 | 给 user_id=13 创建 UQPay ACTIVE 卡 | 完成同用户完整充值链路 |
| P2 | 钱包兑换管理台详情 | 在 admin WalletManagement 中展示兑换记录表（PR #48 后端已支持，前端待完善） |
| P2 | USDT→USD 汇率配置化 | 从 `.env` 或 `system_configs` 表读取，支持动态调整 |
| P3 | reconcile 操作记录管理台视图 | 在管理后台展示 admin_user_id + audit_remark 审计信息 |

---

## 附录

### A. 关键文档索引

| 文档 | 路径 | 内容 |
|------|------|------|
| 钱包字段说明 | `docs/wallet-balance-fields.md` | wallets 表各余额字段用途 |
| 钱包兑换说明 | `docs/wallet-conversion.md` | USDT→USD 兑换流程、API 文档 |
| 部署脚本 | `deploy.sh` | 自动化部署 6 步流程 |
| 数据库备份 | `/opt/backups/backup_vcc_db.sh` | 每天 02:00 备份到 /opt/backups/huifu/ |
| 生产环境 | `43.160.217.82` | 腾讯云轻量，项目路径 /opt/huifu |

### B. 生产服务器关键信息

| 项目 | 值 |
|------|-----|
| IP | 43.160.217.82 |
| SSH 用户 | ubuntu |
| SSH 密钥 | `D:\cardgolinkpem\cardgolink_key.pem` |
| 项目路径 | `/opt/huifu` |
| PM2 进程名 | `vcc-server` |
| 后端端口 | 3001（iptables 限制非 localhost） |
| 管理端口 | 8080（Nginx allow/deny 白名单） |
| 前端 URL | `https://api.cardgolink.com` |
| 管理后台 | `https://admin-cardgolink.com` |

### C. 相关 PR 索引

| PR | 分支 | 标题 | 合并日期 |
|----|------|------|----------|
| #45 | `fix/uqpay-real-recharge` | UQPay real card recharge transaction | 2026-04-27 |
| #48 | `fix/wallet-usdt-to-usd-conversion` | USDT→USD wallet conversion | 2026-04-27 |
| #49 | `fix/uqpay-recharge-audit-fields` | Admin audit fields for UQPay reconciliation | 2026-04-28 |
