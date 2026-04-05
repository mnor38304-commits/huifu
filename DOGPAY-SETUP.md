# DogPay 接入指南

本文档说明如何在 VCC 系统中接入 DogPay 虚拟卡渠道。

## 📋 前置条件

1. 已注册 DogPay 商户账号
2. 已从 DogPay 平台获取 API Key 和 API Secret
3. 已配置 IP 白名单（如需）

## 🚀 快速配置

### 方式一：使用配置脚本（推荐）

```bash
cd server
node scripts/setup-dogpay.js --api-key=你的API_KEY --api-secret=你的API_SECRET
```

可选参数：
- `--api-url`: API 基础 URL（默认: https://api.dogpay.com）
- `--webhook-secret`: Webhook 验签密钥
- `--status`: 渠道状态，1=启用，0=禁用

### 方式二：手动 SQL 配置

1. 编辑 `server/scripts/setup-dogpay.sql`
2. 替换 `YOUR_API_KEY_HERE` 和 `YOUR_API_SECRET_HERE`
3. 在数据库中执行 SQL

## 📊 配置流程

```
┌─────────────────┐
│ 1. 配置渠道信息  │
│   (API Key等)   │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. 同步卡 BIN   │
│   从 DogPay     │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. 配置商户     │
│   可开卡段      │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. 测试开卡     │
└─────────────────┘
```

## 🔧 详细步骤

### 1. 配置渠道信息

运行配置脚本后，会在 `server/scripts/` 目录生成 `dogpay-config.sql` 文件。

执行 SQL 插入渠道配置：

```bash
# 如果你使用 SQLite 命令行工具
sqlite3 data/vcc.db < server/scripts/dogpay-config.sql

# 或者通过管理后台的 SQL 执行功能
```

### 2. 同步卡 BIN 列表

配置完成后，需要同步 DogPay 的卡 BIN 列表到本地数据库：

**通过管理后台 API：**
```bash
curl -X POST http://localhost:3001/api/admin/card-channels/dogpay/sync-bins \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**或者重启服务器后自动同步**（如已实现）

### 3. 配置商户可开卡段

默认情况下，新同步的卡段不会自动分配给商户。需要管理员在后台配置：

1. 登录管理后台
2. 进入「卡段管理」
3. 选择要分配给商户的卡段
4. 设置「商户可开通」权限

或者直接修改数据库：

```sql
-- 允许所有商户开通所有 DogPay 卡段
INSERT INTO merchant_bin_access (merchant_id, bin_id, can_open)
SELECT 
  u.id as merchant_id,
  cb.id as bin_id,
  1 as can_open
FROM users u
CROSS JOIN card_bins cb
WHERE cb.channel_code = 'dogpay' AND cb.status = 1;
```

### 4. 测试开卡流程

配置完成后，测试完整流程：

1. **用户登录** → 获取 JWT Token
2. **获取可用卡段** → `GET /api/cards/bins/available`
3. **创建卡片** → `POST /api/cards`
4. **查看卡片详情** → `GET /api/cards/:id`

## 📡 API 端点

### 用户端点

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/cards/bins/available` | 获取可用卡段 |
| POST | `/api/cards` | 创建卡片 |
| GET | `/api/cards` | 卡片列表 |
| GET | `/api/cards/:id` | 卡片详情 |
| POST | `/api/cards/:id/topup` | 卡片充值 |
| POST | `/api/cards/:id/freeze` | 冻结卡片 |
| POST | `/api/cards/:id/unfreeze` | 解冻卡片 |
| POST | `/api/cards/:id/cancel` | 注销卡片 |

### 管理端点

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/admin/card-channels/dogpay/sync-bins` | 同步 DogPay 卡 BIN |

## 🔐 安全注意事项

1. **API Secret 保密**
   - 不要提交到版本控制
   - 使用环境变量或加密存储
   - 定期更换密钥

2. **Webhook 验签**
   - 配置 Webhook Secret
   - 验证请求签名
   - 只接受来自 DogPay IP 的请求

3. **敏感数据**
   - 卡号、CVV 等敏感信息已加密存储
   - 日志中不输出完整卡号
   - 遵循 PCI DSS 规范

## 🐛 故障排查

### 问题：同步卡 BIN 失败

**检查项：**
1. API Key 和 Secret 是否正确
2. 网络是否能访问 DogPay API
3. 查看服务器日志中的错误信息

**调试命令：**
```bash
# 测试 DogPay API 连通性
curl -X POST https://api.dogpay.com/open-api/v1/auth/access_token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credential",
    "appid": "你的API_KEY",
    "secret": "你的API_SECRET"
  }'
```

### 问题：开卡失败

**检查项：**
1. 商户是否有可开通的卡段权限
2. 卡段状态是否为启用
3. DogPay 账户余额是否充足

### 问题：无法获取卡详情

**检查项：**
1. 卡片 external_id 是否正确存储
2. DogPay API 是否能正常访问
3. 查看 `server/src/channels/dogpay.ts` 中的错误日志

## 📚 相关文件

- `server/src/channels/dogpay.ts` - DogPay SDK
- `server/src/routes/cards.ts` - 卡片路由
- `server/src/dogpay-bin-store.ts` - 卡 BIN 管理
- `server/src/merchant-bin-access.ts` - 商户卡段权限

## 🔗 DogPay 文档

- API 文档: https://docs.dogpay.com
- 商户后台: https://merchant.dogpay.com

---

如有问题，请联系 DogPay 技术支持或查看项目 Issue。
