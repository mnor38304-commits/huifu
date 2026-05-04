# UQPay 用户端充值限额与风控规则设计

> 基于 PR #45 充值链路 + 当前代码库现状设计。本阶段只输出方案。

---

## 1. 现状评估

### 已存在的限制
| 限制 | 位置 | 当前行为 |
|------|------|---------|
| 金额下限 (>0) | `validateTopup()` | 现有 |
| 卡片状态 (status=1) | `validateTopup()` | 现有 |
| 渠道 (仅UQPAY) | `validateTopup()` | 现有 |
| 钱包余额 | `validateTopup()` | 现有 |
| 同卡 PENDING 并发 | `checkPendingOrder()` | 现有 |
| 功能开关 | route | `ENABLE_UQPAY_REAL_RECHARGE` |
| 用户白名单 | route | `UQPAY_RECHARGE_TEST_USER_IDS` |

### 缺失的限制
| 缺失 | 影响 |
|------|------|
| 单笔上限 | 无最大金额 |
| 日累计金额 | 无限制 |
| 日次数 | 无限制 |
| 用户等级 | `users` 表无 level/tier 字段 |
| 失败风控 | 无冻结 |
| 充值速率限制 | 无 |

### 已存在但未使用的字段
- `cards.single_limit` — 充值流程从未读取
- `cards.daily_limit` — 同上

---

## 2. 推荐默认限额

### 单笔充值限制
| 参数 | 推荐值 | env var |
|------|--------|---------|
| 最小金额 | **$10** | `UQPAY_RECHARGE_MIN_AMOUNT=10` |
| 最大金额 | **$5,000** | `UQPAY_RECHARGE_MAX_AMOUNT=5000` |
| 白名单用户 | **$50,000** | 跳过限额 |

### 单用户每日限制
| 参数 | 推荐值 | env var |
|------|--------|---------|
| 日累计金额 | **$10,000** | `UQPAY_RECHARGE_DAILY_LIMIT=10000` |
| 日累计次数 | **10 次** | `UQPAY_RECHARGE_DAILY_COUNT_LIMIT=10` |

### 单卡每日限制
| 参数 | 推荐值 | env var |
|------|--------|---------|
| 卡日累计金额 | **$5,000** | `UQPAY_RECHARGE_CARD_DAILY_LIMIT=5000` |
| 卡日累计次数 | **5 次** | `UQPAY_RECHARGE_CARD_DAILY_COUNT=5` |

### PENDING/UNKNOWN 并发
| 参数 | 推荐值 | env var |
|------|--------|---------|
| 单卡 PENDING | 最多 1 笔 | 已有 `checkPendingOrder()` |
| 单用户 PENDING | **最多 3 笔** | `UQPAY_RECHARGE_USER_PENDING_MAX=3` |
| PENDING 超时 | > 30 分钟 | 已有 `reconcilePendingOrders()` |

### 失败风控
| 参数 | 推荐值 | env var |
|------|--------|---------|
| 连续失败阈值 | **3 次** | `UQPAY_RECHARGE_MAX_CONSECUTIVE_FAILURES=3` |
| 冻结时长 | **30 分钟** | `UQPAY_RECHARGE_FAILURE_FREEZE_MINUTES=30` |
| 成功一次重置 | 自动 | 内存 Map |

---

## 3. 返回错误码与文案

| 场景 | code | message |
|------|------|---------|
| 低于最小金额 | 400 | `单笔充值金额不能少于 $10` |
| 超过最大金额 | 400 | `单笔充值金额不能超过 $5,000` |
| 日累计金额超限 | 400 | `今日充值金额已达上限（$10,000）` |
| 日累计次数超限 | 400 | `今日充值次数已达上限（10次）` |
| 卡日金额超限 | 400 | `该卡今日充值金额已达上限（$5,000）` |
| 卡日次数超限 | 400 | `该卡今日充值次数已达上限（5次）` |
| 用户 PENDING 超限 | 400 | `您有 N 笔充值正在处理中，请等待完成后继续充值` |
| 风控冻结 | 429 | `充值因多次失败已临时冻结，请 30 分钟后重试` |

---

## 4. 数据库需求

### P0：不用新增表
直接用 `uqpay_recharge_orders` 聚合统计：
```sql
SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt
FROM uqpay_recharge_orders
WHERE user_id = ? AND date(created_at) = date('now') AND status NOT IN ('FAILED','CANCELLED');
```
索引 `idx_uqpay_recharge_user_id` / `idx_uqpay_recharge_card_id` 已存在。

### P1：可选 `recharge_limits` 表（动态配置）
### P2：`risk_control_logs` 表（风控日志）

---

## 5. 分阶段实现

### P0：环境变量限额（推荐本次实现）
- 改 3 个文件，2 小时工作量
- 零 DB 迁移，零前端改动
- 上线无风险（当前开关关闭）

### P1：失败告警 + 数据库可配置
- 在 `reconcile-alerts.ts` 追加失败率规则 R9
- 可选新增 `recharge_limits` 表

### P2：管理后台配置页面
- CRUD 限额
- 风控日志查看/导出
- 手动解冻

---

## 6. 需要修改的文件（P0）

| 文件 | 修改内容 |
|------|---------|
| `server/.env.example` | 新增 8 个环境变量 |
| `server/src/services/uqpay-recharge.ts` | `validateTopup()` 追加：单笔上下限、日累计、卡日累计、用户PENDING、失败风控 |
| `server/src/routes/cards.ts` | 白名单用户跳过所有限额校验 |

---

## 7. 测试清单（14 项）

| # | 场景 | 预期 |
|---|------|------|
| 1 | 充值 $5（< $10） | code:400, "金额不能少于" |
| 2 | 充值 $10,000（> $5,000） | code:400, "金额不能超过" |
| 3 | 日累计 $9,500 + 再充 $600（超 $10,000） | code:400, "日累计金额已达上限" |
| 4 | 已充 10 次 + 再充 1 次 | code:400, "次数已达上限" |
| 5 | 卡日累计 $4,800 + 再充 $300（超 $5,000） | code:400, "该卡今日充值金额已达上限" |
| 6 | 已有 3 笔 PENDING + 再充 | code:400, "正在处理中" |
| 7 | 连续失败 3 次 + 再充 | code:429, "临时冻结" |
| 8 | 白名单充值 $50,000 | 正常通过（跳过限额） |
| 9 | 冻结过期后充值 | 正常通过 |
| 10 | 环境变量未设置 | 使用默认值 |
| 11 | ENABLE_UQPAY_REAL_RECHARGE=false 时 | 现有逻辑 "暂未开放" |
| 12 | 所有校验通过后 | 正常进入扣钱包+UQPay API |
| 13 | 失败后成功一次 | 计数器重置 |
| 14 | 修改环境变量 + pm2 restart | 新限额生效 |

---

## 8. 下一步建议

**建议立即创建 PR。**

理由：
- 当前无任何限额，一旦开放 ENABLE_UQPAY_REAL_RECHARGE=true，用户可单次充值任意金额
- 所有环境变量有默认值，不会因忘记配置而阻塞
- 不改 DB、不改前端、不影响现有 mock/非UQPay 充值流程
- 开关关闭状态下部署零风险

建议分支：`fix/uqpay-recharge-limits-p0`
建议 PR 标题：`feat: add UQPay recharge limits & risk control (P0)`
