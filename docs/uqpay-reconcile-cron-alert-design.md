# UQPay Reconcile 定时任务与告警方案设计

> 文档状态：方案设计稿
> 对应模块：UQPay 充值订单补偿 + PENDING/UNKNOWN 告警
> 当前生产：reconcile CLI 已可用，admin_user_id / audit_remark 已上线

---

## 1. Crontab 方案

### 1.1 定时任务配置

```cron
# ── UQPay 充值订单补偿（每 10 分钟）─────────────────────────
*/10 * * * * ubuntu cd /opt/huifu/server && npm run reconcile:uqpay-recharges >> /var/log/uqpay-reconcile.log 2>&1
```

### 1.2 执行脚本说明

`npm run reconcile:uqpay-recharges` 当前行为：
- 调用 `reconcilePendingOrders()` 默认参数：maxOrders=10, minAgeMinutes=5
- 扫描 status IN ('PENDING', 'UNKNOWN') 且创建超过 5 分钟的订单
- 逐条调用 UQPay SDK `getCard()` 查询卡状态 + 余额比对
- 写入 `admin_user_id=NULL, audit_remark='cron自动对账'`

### 1.3 建议 crontab 增强

```cron
# ── UQPay 充值订单补偿（每 10 分钟）─────────────────────────
*/10 * * * * ubuntu flock -n /tmp/uqpay-reconcile.lock bash -c 'cd /opt/huifu/server && npm run reconcile:uqpay-recharges -- --max-orders=10 --min-age=10 --remark="cron自动对账" >> /var/log/uqpay-reconcile.log 2>&1'

# ── PENDING/UNKNOWN 告警扫描（每 5 分钟）────────────────────
*/5 * * * * ubuntu cd /opt/huifu/server && npm run alert:pending-orders >> /var/log/uqpay-alert.log 2>&1
```

**flock 说明**：防止上一轮未完成时重复执行（reconcile 涉及 UQPay API 调用，可能耗时 > 10 分钟）。

---

## 2. 日志轮转

### 2.1 日志文件

| 文件 | 用途 |
|------|------|
| `/var/log/uqpay-reconcile.log` | Reconcile 执行日志（每轮 scan 结果） |
| `/var/log/uqpay-alert.log` | 告警扫描日志（超时/异常记录） |

### 2.2 logrotate 配置

```conf
# /etc/logrotate.d/uqpay-reconcile
/var/log/uqpay-reconcile.log
/var/log/uqpay-alert.log {
    daily
    rotate 30
    maxsize 10M
    compress
    delaycompress
    missingok
    notifempty
    su ubuntu ubuntu
    create 0644 ubuntu ubuntu
}
```

| 参数 | 值 | 说明 |
|------|-----|------|
| 轮转周期 | daily | 每天轮转 |
| 保留天数 | 30 天 | 可回溯一个月 |
| 单文件上限 | 10M | 达到即提前轮转 |
| 压缩 | gzip | 节省磁盘 |
| 创建权限 | 0644 ubuntu | 与 PM2 用户一致 |

---

## 3. 告警规则

### 3.1 告警等级定义

| 等级 | 颜色 | 响应要求 |
|------|------|----------|
| INFO | 蓝 | 仅记录，无需处理 |
| WARNING | 黄 | 需关注，下一个工作日处理 |
| CRITICAL | 红 | 需立即处理，可能导致资金异常 |

### 3.2 告警规则表

| # | 规则 | 触发条件 | 等级 | 说明 |
|---|------|---------|------|------|
| R1 | PENDING 超时警告 | 同一订单 PENDING 持续 > 10 分钟 | WARNING | webhook 可能延迟或丢失 |
| R2 | PENDING 超时严重 | 同一订单 PENDING 持续 > 30 分钟 | CRITICAL | 大概率 webhook 丢失，需人工介入 |
| R3 | UNKNOWN 超时警告 | 同一订单 UNKNOWN 持续 > 10 分钟 | WARNING | 余额不匹配，需人工审核 |
| R4 | Reconcile 连续失败 | 同一订单连续 3 次 reconcile 异常（非终态） | CRITICAL | UQPay API 可能异常或卡状态异常 |
| R5 | Reconcile 整体异常率 | 单轮 scan 中异常订单占比 > 50% | CRITICAL | UQPay 服务可能不可用 |
| R6 | Webhook payload=null 计数 | 1 小时内收到 > 5 次 payload=null | WARNING | webhook 数据异常，可能影响结算 |
| R7 | Webhook 匹配失败 | 1 小时内收到 > 3 次 NEEDS_RECONCILE | WARNING | 订单匹配策略需要 review |
| R8 | Reconcile 余额证据不足 | 余额变化 > 0 但与订单金额不匹配 | WARNING | 标记 UNKNOWN，需人工确认 |

### 3.3 告警关联表（新增）

为了实现上述告警规则，建议新增一张告警追踪表（见第 5 节）：

```sql
CREATE TABLE IF NOT EXISTS reconcile_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    alert_type TEXT NOT NULL,        -- PENDING_TIMEOUT / UNKNOWN_TIMEOUT / RECONCILE_FAILURE / WEBHOOK_MISMATCH / PAYLOAD_NULL
    alert_level TEXT NOT NULL DEFAULT 'WARNING',  -- INFO / WARNING / CRITICAL
    message TEXT NOT NULL,
    record_count INTEGER DEFAULT 0,  -- 累计触发次数
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by INTEGER,             -- admin_user_id
    resolution_note TEXT,
    FOREIGN KEY (order_id) REFERENCES uqpay_recharge_orders(id)
);
```

---

## 4. 告警输出方式

### 4.1 输出路径（按优先级）

| 优先级 | 输出方式 | 实现阶段 |
|--------|---------|----------|
| P0 | 写入 `admin_logs` 表 | 立即实现 |
| P0 | 写入本地日志文件 | 立即实现 |
| P1 | 管理后台仪表盘告警面板 | 下一批前端 PR |
| P2 | Telegram Bot 通知 | 后续迭代 |
| P2 | 邮件通知 | 后续迭代 |

### 4.2 Admin Logs 记录规范

```typescript
// 告警级别前缀
// [RECONCILE_WARN]  — WARNING
// [RECONCILE_CRIT]  — CRITICAL

writeAdminLog({
    adminId: 0,           // 系统自动操作使用 adminId=0
    adminName: 'System',
    action: 'reconcile_alert',
    targetType: 'uqpay_recharge_order',
    targetId: orderId,
    detail: `[RECONCILE_WARN] 订单 PENDING 超过 10 分钟, order_id=5, created_at=2026-04-28T23:00:00`,
});
```

### 4.3 本地日志格式

```
[2026-04-28T23:10:00] [RECONCILE] scan start: maxOrders=10, minAge=10
[2026-04-28T23:10:05] [RECONCILE_CRIT] order_id=5 PENDING timeout > 30min, matched=none, action=keep_pending
[2026-04-28T23:10:06] [RECONCILE] scan done: total=5, succeeded=0, failed=0, unchanged=5, errors=0
```

---

## 5. 是否需要新增表/字段

### 5.1 新增 `reconcile_alerts` 表（推荐 ✅）

**理由**：
- 需要追踪告警的首次/最后触发时间
- 需要区分同一订单的多次告警 vs 持续告警
- 管理后台需要展示告警列表+解决状态

**表结构**（见 3.3 节）

### 5.2 新增 `reconcile_logs` 表（可选 ❌ 暂不引入）

**理由**：
- 当前 `admin_logs` + 本地日志文件已可覆盖
- 不需要为 reconcile 单独建表增加复杂度
- 如果需要管理后台查看历史 scan 记录，后续可加

### 5.3 `uqpay_recharge_orders` 新增字段（不必要 ❌）

**理由**：
- `admin_user_id` 和 `audit_remark` 已覆盖审计需求
- 告警状态应由 `reconcile_alerts` 表管理，避免主表膨胀

---

## 6. 管理后台建议

### 6.1 页面/组件

| 页面 | 功能 | 优先级 |
|------|------|--------|
| PENDING/UNKNOWN 订单列表 | 按状态筛选，显示创建时间、持续时长、最后 scan 时间 | P1 |
| 一键 reconcile | 选中订单 → 单条/批量 reconcile | ✅ 已有 API |
| Webhook 事件查看 | 按 order_id 关联 `uqpay_webhook_events`，查看原始 payload | P2 |
| 审计备注查看 | 显示 `admin_user_id` + `audit_remark` 列 | ✅ PR #49 已支持 |
| 导出 CSV | 订单列表 CSV 导出 | P2 |
| 告警面板 | 展示当前未解决告警，按等级排序 | P2 |

### 6.2 管理后台 API（已有）

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/admin/cards/:id/reconcile` | POST | 单条 reconcile |
| `/api/admin/cards/reconcile-pending` | POST | 批量 reconcile |
| `/api/admin/logs` | GET | 查询 admin_logs（含告警记录） |

---

## 7. 风险

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| UQPay 沙箱 PENDING 不结算 | 沙箱环境下充值可能永久 PENDING | reconcile 检测到卡存在但余额无变化时保持 PENDING，不自动修改 |
| Webhook 延迟 | 生产环境 webhook 可能数分钟后才到达 | 10 分钟为 WARNING，30 分钟为 CRITICAL，留有足够缓冲 |
| 余额证据不足不能改 SUCCESS | `getCard()` 返回余额无法精确定位到该笔充值 | 余额变化 ±$0.01 才确认 SUCCESS，否则标记 UNKNOWN |
| 不能自动回滚处理中订单 | 正在处理的订单可能余额被扣但未到账 | reconcile 只处理创建超过 10 分钟的订单 |
| Reconcile 并发冲突 | 多个 reconcile 同时处理同一订单 | `flock` + 数据库 `WHERE status IN ('PENDING', 'UNKNOWN')` 双重保护 |
| 告警风暴 | 多个订单同时超时产生大量告警 | `reconcile_alerts` 表按 order+type 去重更新 `last_seen_at`，不重复插入 |
| UQPay API 限流 | 高频调用 `getCard()` 可能被限流 | 每轮最多 10 条，10 分钟一次，QPS ≈ 0.016，远低于常见限流阈值 |

---

## 8. 实施排期

### 8.1 P0 — 立即实现（本周）

| # | 任务 | 工作项 | 预计工作量 |
|---|------|--------|-----------|
| 1.1 | 新增 `reconcile_alerts` 表 | db.ts schema + ALTER TABLE 迁移 | 1 file, 20 lines |
| 1.2 | 告警写入函数 `createAlert()` | 自动去重，相同 order+type 只更新 `last_seen_at`+`record_count` | 1 function |
| 1.3 | reconcile 集成告警 | `reconcilePendingOrders()` 改为异步写 `reconcile_alerts` + `admin_logs` | 修改现有函数 |
| 1.4 | 告警扫描 CLI `npm run alert:pending-orders` | 独立扫描脚本，不依赖 reconcile scan | 1 新脚本 |
| 1.5 | Crontab + logrotate 配置 | `/etc/cron.d/uqpay-reconcile` + `/etc/logrotate.d/uqpay-reconcile` | 2 个配置文件 |
| 1.6 | 测试 | 本地 mock alert 写入 + crontab 安装验证 | 联调 |

### 8.2 P1 — 短期迭代（下一批）

| # | 任务 | 说明 |
|---|------|------|
| 2.1 | 管理后台 PENDING/UNKNOWN 订单列表 | 按状态/时间筛选 |
| 2.2 | 管理后台告警面板 | `reconcile_alerts` 表展示/解决 |
| 2.3 | reconcile CLI 参数支持 | `--max-orders=N --min-age=N --remark="xxx"` |
| 2.4 | Flock 防并发 | 安装 `flock` 并加入 crontab |

### 8.3 P2 — 后续迭代

| # | 任务 | 说明 |
|---|------|------|
| 3.1 | Webhook payload=null 计数告警 | 独立脚本或 webhook 处理器内增强 |
| 3.2 | Telegram Bot 通知 | 接入第三方通知渠道 |
| 3.3 | CSV 导出 | 管理后台订单导出 |
| 3.4 | 仪表盘 reconcile 统计 | 日/周/月成功率曲线 |

---

## 9. 方案总结

### 9.1 新增文件

| 文件 | 类型 | 用途 |
|------|------|------|
| `server/src/scripts/alert-pending-orders.ts` | Node 脚本 | PENDING/UNKNOWN 告警扫描 |
| `server/src/services/reconcile-alerts.ts` | Service | 告警写入/查询逻辑 |
| `/etc/cron.d/uqpay-reconcile` | 配置文件 | crontab 定时任务 |
| `/etc/logrotate.d/uqpay-reconcile` | 配置文件 | 日志轮转 |

### 9.2 修改文件

| 文件 | 修改内容 |
|------|---------|
| `server/src/db.ts` | 新增 `reconcile_alerts` 表 CREATE TABLE + ALTER TABLE |
| `server/src/scripts/scan-reconcile.ts` | 集成告警写入 + CLI 参数增强 |
| `server/package.json` | 新增 `scripts.alert:pending-orders` |

### 9.3 不修改

- `uqpay_recharge_orders` 表结构（已有 admin_user_id + audit_remark）
- `reconcileRechargeOrder()` / `reconcilePendingOrders()` 核心逻辑
- 现有 webhook 处理流程
- 用户端充值 API

### 9.4 是否需要新 PR

**是的，建议单独一条 PR**：

> PR 标题：`feat: uqpay reconcile cron job and pending order alerting`
>
> 包含：reconcile_alerts 表 + 告警写入逻辑 + CLI + crontab 配置 + logrotate 配置

与 PR #45（充值流程）、#48（钱包兑换）、#49（审计字段）保持职责分离。
