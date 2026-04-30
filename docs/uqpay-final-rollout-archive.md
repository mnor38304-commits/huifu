# UQPay 充值与钱包兑换生产验证最终归档报告

> 生成日期：2026-04-29 23:30
> 归档范围：PR #51 ~ PR #54 全链路生产验证

---

## 1. 本阶段完成的 PR

| PR | 分支 | 状态 | 描述 |
|----|------|------|------|
| [#51](https://github.com/mnor38304-commits/huifu/pull/51) | `fix/uqpay-recharge-limits-p0` | OPEN，未合并 | UQPay 充值限额与风控 P0（单笔 $10~$5,000、用户日 $10,000/10次、卡日 $5,000/5次、PENDING 并发 3、失败冻结 3次→30min） |
| [#52](https://github.com/mnor38304-commits/huifu/pull/52) | `fix/admin-uqpay-recharge-monitoring-p1` | **已合并到 main，已部署** | Admin UQPay 充值监控只读页面（订单列表、详情弹窗、webhook 记录、配置指引） |
| [#53](https://github.com/mnor38304-commits/huifu/pull/53) | `fix/uqpay-reconcile-dry-run` | **已合并到 main，已部署** | Reconcile dry-run 支持（--dry-run --json，不写库、不执行充值、readOnlyExternalCall） |
| [#54](https://github.com/mnor38304-commits/huifu/pull/54) | `fix/sync-initial-uqpay-card-balance` | **已合并到 main，已部署** | UQPay 开卡初始余额同步（createCard response → getCard 只读查询 → fallback 0） |

---

## 2. 当前生产状态

### Git HEAD

```
e3c3dbb Merge branch 'main' of https://github.com/mnor38304-commits/huifu
66d54de Merge PR #54: fix: sync initial UQPay card available balance on card creation
7f59295 fix: sync initial UQPay card available balance on card creation
```

### 服务状态

| 指标 | 值 |
|------|-----|
| PM2 vcc-server | **online**（restarts: 108，uptime: 2m） |
| Health API | `{"status":"ok"}` |
| PM2 开机自启 | 已启用 |
| Nginx | master + 2 workers，配置正确 |

### 定时任务

```
0 2 * * *   数据库备份（保留 7 天）
*/5 * * * * UQPay pending/unknown alert 扫描（flock 防并发）
*/10 * * * * UQPay reconcile（flock 防并发）
```

### Logrotate

- 路径：`/etc/logrotate.d/uqpay-reconcile`
- 日志文件：`/var/log/uqpay-reconcile.log` + `/var/log/uqpay-alert.log`（ubuntu:ubuntu 644）
- 策略：daily, size 10M, rotate 30, compress, missingok, notifempty, copytruncate

### 开关状态

```
ENABLE_UQPAY_REAL_RECHARGE=false
ENABLE_WALLET_CONVERT=false
UQPAY_RECHARGE_TEST_USER_IDS=2,13
WALLET_CONVERT_TEST_USER_IDS=13,2
```

### 数据库统计

| 表 | 记录数 |
|----|--------|
| uqpay_recharge_orders | 6 |
| wallet_conversions | 2 |
| wallet_records | 22 |
| cards | 6（其中 user_id=13 持 4 张） |
| reconcile_alerts | 0（无误报） |

### 测试用户钱包

| 用户 | balance_usd | balance_usdt |
|------|-------------|--------------|
| user_id=13 | 90 | 99 |

---

## 3. 已验证完整链路

### 链路流程

```
USDT → USD 兑换 → 用户端卡充值 → UQPay 沙箱处理 → webhook → reconcile/alert 扫描
```

### 第一步：USDT→USD 兑换

| 操作 | 值 |
|------|-----|
| 金额 | 1 USDT → 1 USD（rate=1.0） |
| balance_usdt | 100 → 99 |
| balance_usd | 90 → 91 |
| wallet_conversions | id=2, COMPLETED |
| 幂等 | 重复 Idempotency-Key 返回"该订单已处理"，不重复扣款 |

### 第二步：UQPay 用户端 1 USD 充值

| 操作 | 值 |
|------|-----|
| 方式 | `POST /api/v1/cards/6/topup`（用户端 JWT 鉴权） |
| 订单 | uqpay_recharge_orders id=6，SUCCESS |
| wallet.balance_usd | 91 → 90 |
| uqpay_recharge_orders | 6 条（FAILED=3, SUCCESS=3），零 PENDING/UNKNOWN |
| reconcile cron | 扫描到 SUCCESS 订单，跳过 |
| alert cron | 扫描到终态订单，无误报 |

### cards.balance 0→101 说明

- **原因**：UQPay 沙箱创建卡时将 `card_limit(100)` 作为初始 `card_available_balance`，但本地绑定脚本硬编码 `balance=0`
- **影响**：仅本地显示跳变，无资损风险（钱包扣款 1 USD 正确，卡实际余额从 100 增加到 101）
- **修复**：PR #54 已修复，后续开卡时优先同步 UQPay 侧 `card_available_balance`
- **确认**：`markRechargeSuccess()` 同步逻辑正确，101 是 UQPay 沙箱真实余额

---

## 4. 已上线安全能力

| 能力 | 实现 | 状态 |
|------|------|------|
| **总开关** | `ENABLE_UQPAY_REAL_RECHARGE` | ✅ 当前 false |
| **白名单** | `UQPAY_RECHARGE_TEST_USER_IDS=2,13` | ✅ |
| **单笔限额** | `$10 ~ $5,000`（PR #51，未合并，已编码） | ⚠️ 代码就绪，未部署 |
| **用户日限额** | `$10,000 / 10次`（PR #51） | ⚠️ 同上 |
| **单卡日限额** | `$5,000 / 5次`（PR #51） | ⚠️ 同上 |
| **PENDING 并发保护** | `checkPendingOrder()` | ✅ 已部署 |
| **失败冻结** | 内存 Map，3 次失败 → 冻结 30 分钟（PR #51） | ⚠️ 代码就绪，未部署 |
| **Reconcile 定时任务** | `*/10 * * * *`，flock 防并发 | ✅ 已启用 |
| **Alert 扫描** | `*/5 * * * *`，flock 防并发 | ✅ 已启用 |
| **Admin 只读监控** | `/admin/uqpay-monitor` 页面 | ✅ 已部署 |
| **敏感字段脱敏** | PAN/CVV/token 不输出 | ✅ |
| **Wallet 兑换开关** | `ENABLE_WALLET_CONVERT` | ✅ 当前 false |
| **Wallet 兑换白名单** | `WALLET_CONVERT_TEST_USER_IDS=13,2` | ✅ |
| **兑换幂等** | `Idempotency-Key` 防重复 | ✅ |
| **日志 logrotate** | daily, size 10M, rotate 30 | ✅ |
| **数据库备份** | 每天 02:00，保留 7 天 | ✅ |

---

## 5. 当前风险与限制

### 功能开关

| 风险 | 说明 |
|------|------|
| **ENABLE_UQPAY_REAL_RECHARGE=false** | 用户端充值 API 返回 400 "UQPay 真实充值暂未开放"。仅白名单用户可操作 |
| **ENABLE_WALLET_CONVERT=false** | 钱包兑换 API 返回 403。仅白名单用户可操作 |
| **白名单不可动态** | 修改后需 `pm2 restart vcc-server --update-env` 生效 |

### 技术债务

| 风险 | 说明 |
|------|------|
| **失败冻结 P0 在内存** | PR #51 的 `failureCountMap` 是内存 `Map`，PM2 重启后归零。正式上线前需改为持久化存储 |
| **限额校验 P0 未部署** | PR #51 未合并 main。当前生产无单笔/日累计/失败冻结保护 |
| **card_available_balance 依赖 UQPay** | 余额来源为 UQPay API 返回值。SDK GET 请求有 400 问题（`getCard` 返回 undefined） |
| **sandbox → production 切换** | 当前配置指向 `api-sandbox.uqpaytech.com`。切生产前需：新 clientId/apiKey、重启、全量回归 |
| **webhook 回调验证** | 当前充值返回同步 SUCCESS（沙箱行为），生产环境为异步 PENDING + webhook。webhook 路径/签名验证未在生产验证 |

### 运维

| 风险 | 说明 |
|------|------|
| **crontab 观察期不足** | 自启用不到 2 小时，建议继续观察 24-48 小时 |
| **日志权限问题** | `/var/log/` 下日志文件需 `ubuntu:ubuntu` 权限，logrotate `copytruncate` 保持权限 |

---

## 6. 后续灰度建议

### 短期（24-48 小时）

- [ ] 继续监控 `crontab` alert/reconcile 日志，确认无异常
- [ ] 保持白名单仅 `user_id=2,13`
- [ ] 每次测试前手动打开开关 → 测试 → 立即关闭
- [ ] 每次测试后检查：
  - Admin `uqpay-monitor` 页面订单 + webhook
  - `tail -50 /var/log/uqpay-alert.log`
  - `tail -50 /var/log/uqpay-reconcile.log`
  - `reconcile_alerts` 记录数

### 中期（灰度扩展）

- [ ] 每次新增 1-2 个测试用户到白名单
- [ ] 单次充值保持小额（$1~$10）
- [ ] 测试成功后检查 webhook 回调完整性
- [ ] 确认 `ENABLE_WALLET_CONVERT` 与 `ENABLE_UQPAY_REAL_RECHARGE` 联合工作流

### 正式开放前

- [ ] **PR #51 限额风控必须合并并部署**（失败冻结持久化、限额入库）
- [ ] 通知/告警系统接入（短信/邮件/企业微信）
- [ ] 生产 UQPay 账号注册与配置（`api.uqpaytech.com`）
- [ ] Webhook 签名验证完善
- [ ] 压测（并发充值场景）
- [ ] 数据库备份脚本验证
- [ ] logrotate 自动轮转验证

---

## 7. 不建议现在做的事

| 操作 | 理由 |
|------|------|
| **全量打开 UQPAY_REAL_RECHARGE=true** | 限额风控 P0 未部署，无保护措施 |
| **全量打开 WALLET_CONVERT=true** | 未经生产实际资金流验证 |
| **关闭 crontab** | reconcile 和 alert 是生产监控最后一道防线 |
| **删除近期验证日志** | PR #53 的 dry-run 记录和 webhook payload 记录不可替代 |
| **扩大白名单到真实客户** | 需求验证周期不足，资金安全风险 |
| **切到 UQPay 生产环境** | 需重新注册 clientId/apiKey，全链路回归 |
| **跳过 PR #51 直接上线** | 无单笔/日累计/失败冻结约束，高频充值或大额充值无法控制 |
| **启用 auto-merge** | 生产分支的合并应人工确认 |

---

## 附录 A：关键文件索引

| 文件 | 说明 |
|------|------|
| `docs/uqpay-recharge-limits-design.md` | 限额与风控设计文档 |
| `docs/uqpay-reconcile-cron-alert-design.md` | Reconcile & Alert 设计文档 |
| `docs/uqpay-wallet-rollout-report.md` | 钱包兑换上线报告 |
| `docs/wallet-conversion.md` | 钱包兑换功能文档 |
| `docs/wallet-balance-fields.md` | 钱包余额字段说明 |
| `docs/uqpay-final-rollout-archive.md` | **本文档** |

## 附录 B：环境配置

```
服务器：腾讯云轻量 43.160.217.82
SSH 用户：ubuntu
私钥：D:\cardgolinkpem\cardgolink_key.pem
项目路径：/opt/huifu
数据库：server/data/vcc.db（sql.js 内存 SQLite + 文件持久化）
PM2 进程名：vcc-server
UQPay 环境：https://api-sandbox.uqpaytech.com（沙箱）
```
