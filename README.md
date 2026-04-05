# VCC 商户端系统 (虚拟卡管理平台)

> 基于 React + Node.js + SQLite 的全栈虚拟信用卡管理系统

## 📁 项目结构

```
vcc-system/
├── server/                 # 后端服务
│   ├── src/
│   │   ├── db.ts          # 数据库初始化
│   │   ├── index.ts       # 入口文件
│   │   ├── seed.ts        # 种子数据
│   │   ├── types.ts       # TypeScript 类型
│   │   ├── middleware/    # 中间件
│   │   │   └── auth.ts    # JWT 认证
│   │   └── routes/        # API 路由
│   │       ├── auth.ts    # 认证接口
│   │       ├── kyc.ts     # 实名认证
│   │       ├── cards.ts   # 卡片管理
│   │       ├── transactions.ts  # 交易查询
│   │       ├── bills.ts   # 账单中心
│   │       └── notices.ts # 公告系统
│   └── package.json
│
├── client/                 # 前端应用
│   ├── src/
│   │   ├── main.tsx       # 入口
│   │   ├── App.tsx        # 主应用
│   │   ├── services/     # API 服务
│   │   │   └── api.ts
│   │   └── pages/        # 页面组件
│   │       ├── Login.tsx
│   │       ├── Register.tsx
│   │       ├── Dashboard.tsx
│   │       ├── Cards.tsx
│   │       ├── CardDetail.tsx
│   │       ├── Transactions.tsx
│   │       ├── Bills.tsx
│   │       └── Settings.tsx
│   └── package.json
│
└── README.md
```

## 🚀 快速启动

### 1. 启动后端

```bash
cd vcc-system/server
npm install
npm run dev
```

后端服务将在 http://localhost:3001 启动

### 2. 启动前端

```bash
cd vcc-system/client
npm install
npm run dev
```

前端应用将在 http://localhost:5173 启动

### 3. 访问系统

打开浏览器访问 http://localhost:5173

## 👤 测试账号

| 手机号 | 密码 |
|--------|------|
| 13800138000 | demo123 |
| 13800138001 | demo123 |

## 📱 功能模块

### ✅ 已实现功能

1. **用户认证**
   - 手机号/邮箱注册
   - 短信/邮箱验证码
   - 密码登录
   - JWT Token 认证

2. **账户概览**
   - 余额展示（总余额/可用余额/冻结金额）
   - 快捷操作入口
   - 公告轮播
   - 卡片预览

3. **VCC 卡片管理**
   - 创建卡片（广告卡/采购卡/订阅卡）
   - 卡片充值
   - 冻结/解冻卡片
   - 注销卡片
   - 查看完整卡号/CVV（需点击揭示）

4. **交易查询**
   - 按卡片/类型/状态筛选
   - 时间范围筛选
   - 商户搜索
   - 分页展示

5. **账单中心**
   - 月度账单列表
   - 账单统计
   - 账单详情

6. **设置**
   - 用户信息查看
   - 实名认证（个人/企业）
   - 用户协议

## 🔧 技术栈

### 后端
- Node.js + Express
- SQLite (better-sqlite3)
- JWT 认证
- bcrypt 密码加密
- TypeScript

### 前端
- React 18
- TypeScript
- Vite
- Ant Design 5
- React Router v6
- Axios

## 📝 API 接口

基础路径: `/api/v1`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/register | 用户注册 |
| POST | /auth/login | 用户登录 |
| GET | /auth/me | 获取用户信息 |
| GET | /cards | 获取卡片列表 |
| POST | /cards | 创建卡片 |
| GET | /cards/:id | 卡片详情 |
| POST | /cards/:id/topup | 卡片充值 |
| GET | /transactions | 交易列表 |
| GET | /bills | 账单列表 |
| GET | /notices | 公告列表 |

## 📄 许可证

MIT License
