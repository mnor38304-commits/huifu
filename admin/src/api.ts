import axios from 'axios'

// ✅ FIX: Token 升级为 httpOnly Cookie（后端 admin-auth.ts 写入）
// 优势：
// 1. httpOnly: JS 无法读写，XSS 攻击无法窃取 token
// 2. 自动随请求发送，页面刷新不丢失登录状态
// 3. 后端 logout 时主动清除 Cookie
const BASE = axios.create({
  baseURL: '/api/admin',
  timeout: 10000,
  withCredentials: true,  // 关键：跨域请求携带 Cookie
})

// ✅ 不再设置 Authorization Header，Token 完全由 httpOnly Cookie 提供
BASE.interceptors.request.use(config => config)

// 401 统一处理：清除 Cookie 并跳转登录
BASE.interceptors.response.use(r => r.data, err => {
  if (err.response?.status === 401) {
    document.cookie = 'admin_token=; Max-Age=0; path=/';
    window.location.href = '/login'
  }
  return Promise.reject(err)
})

// ✅ 后端 login 成功后写入 httpOnly Cookie，前端无需手动存储
export const login = (u, p) => BASE.post('/auth/login', { username: u, password: p })
export const getAdminInfo = () => BASE.get('/auth/me')
export const logout = () =>
  BASE.post('/auth/logout').finally(() => {
    window.location.href = '/login'
  })

export const getDashboard = () => BASE.get('/dashboard/stats')
export const getMerchants = p => BASE.get('/merchants', { params: p })
export const getMerchantDetail = id => BASE.get(`/merchants/${id}`)
export const getMerchantBinPermissions = id => BASE.get(`/merchants/${id}/bin-permissions`)
export const updateMerchantBinPermissions = (id, binIds) => BASE.post(`/merchants/${id}/bin-permissions`, { binIds })
export const setMerchantStatus = (id, s) => BASE.post(`/merchants/${id}/status`, { status: s })
export const getKycPending = p => BASE.get('/merchants/kyc/pending', { params: p })
export const auditKyc = (id, a, r) => BASE.post(`/merchants/kyc/${id}/audit`, { action: a, rejectReason: r })
export const getBins = (p: any) => BASE.get('/cards/bins', { params: { channelCode: 'ALL', ...p } })
export const createBin = d => BASE.post('/cards/bins', d)
export const updateBin = (id, d) => BASE.put(`/cards/bins/${id}`, d)
export const bulkUpdateBinRates = (ids, rates) => BASE.post('/cards/bins/batch-rates', { ids, rates })
export const getCards = p => BASE.get('/cards/cards', { params: p })
export const setCardStatus = (id, s, r) => BASE.post(`/cards/cards/${id}/status`, { status: s, reason: r })

// 辅助函数：将camelCase转换为snake_case
function toSnakeCase(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(toSnakeCase)
  const result: any = {}
  for (const key of Object.keys(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    result[snakeKey] = obj[key]
  }
  return result
}

export const getChannels = () => BASE.get('/cards/channels')
export const createChannel = d => BASE.post('/cards/channels', toSnakeCase(d))
export const updateChannel = (id, d) => BASE.put(`/cards/channels/${id}`, toSnakeCase(d))
// 同步DogPay渠道的BIN
export const syncDogPayBins = () => BASE.post('/cards/channels/dogpay/sync-bins')
// 同步GEO渠道的BIN
export const syncGeoBins = () => BASE.post('/cards/channels/geo/sync-bins')
// 同步UQPay渠道的BIN
export const syncUqpayBins = () => BASE.post('/cards/channels/uqpay/sync-bins')

// ── 持卡人管理（独立路由 /api/admin/cardholders）──────────────
export const getCardholders = p => BASE.get('/cardholders', { params: p })
export const getCardholderDetail = (id: number | string) => BASE.get(`/cardholders/${id}`)
export const createCardholder = d => BASE.post('/cardholders', d)
export const batchValidateCardholders = d => BASE.post('/cardholders/batch/validate', d)
export const batchCreateCardholders = d => BASE.post('/cardholders/batch/create', d)
export const getCardholderSchema = (channelCode: string) => BASE.get(`/cardholders/schema?channelCode=${channelCode}`)
export const getCardholderChannelList = () => BASE.get('/cardholders/schema/list')
export const downloadCardholderTemplate = (channelCode = 'DOGPAY') => `/api/admin/cardholders/template/download?channelCode=${channelCode}`
export const updateCardholderEmail = (id: number, email: string) => BASE.patch(`/cardholders/${id}/email`, { email })
export const getUsdtOrders = p => BASE.get('/usdt/orders', { params: p })
export const confirmUsdt = (id, tx) => BASE.post(`/usdt/orders/${id}/confirm`, { txHash: tx })
export const getUsdtStats = () => BASE.get('/usdt/stats')
export const syncUsdtOrder = (id: number) => BASE.post(`/usdt/orders/${id}/sync`)
export const getUsdtOrderDetail = (id: number) => BASE.get(`/usdt/orders/${id}/detail`)
export const getUsdtAddress = (network: string) => BASE.get('/usdt/address', { params: { network } })
export const getTransactions = p => BASE.get('/ops', { params: p })
export const getTxnStats = () => BASE.get('/ops/stats')
export const getNotices = () => BASE.get('/ops/notices')
export const createNotice = d => BASE.post('/ops/notices', d)
export const updateNotice = (id, d) => BASE.put(`/ops/notices/${id}`, d)
export const deleteNotice = id => BASE.delete(`/ops/notices/${id}`)
export const getLogs = p => BASE.get('/ops/logs', { params: p })

// 商户钱包管理
export const getWalletList = p => BASE.get('/wallet/list', { params: p })
export const getWalletDetail = (userId: number) => BASE.get(`/wallet/${userId}`)
export const adjustWalletBalance = (userId: number, amount: number, type: 'increase' | 'decrease', reason: string) =>
  BASE.post('/wallet/adjust', { userId, amount, type, reason })
export const getWalletRecords = (userId: number, p?: any) => BASE.get(`/wallet/records/${userId}`, { params: p })
export const getWalletConversions = (userId: number, p?: any) => BASE.get(`/wallet/conversions/${userId}`, { params: p })

// ── UQPay 监控 ────────────────────────────────────────────────
export const getUqpayRechargeOrders = (p: any) => BASE.get('/uqpay/recharge-orders', { params: p })
export const getUqpayReconcileAlerts = (p: any) => BASE.get('/uqpay/reconcile-alerts', { params: p })
export const getUqpayWebhookEvents = (p: any) => BASE.get('/uqpay/webhook-events', { params: p })

export default BASE
