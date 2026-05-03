import axios from 'axios'

// ✅ FIX: Token 升级为 httpOnly Cookie（后端 auth.ts / admin-auth.ts 写入）
// 优势：
// 1. httpOnly: JS 无法读写，XSS 攻击无法窃取 token
// 2. 自动随请求发送，页面刷新不丢失登录状态
// 3. 后端 logout 时主动清除 Cookie
// 不再需要内存变量或 localStorage，axios 依赖浏览器自动携带 Cookie
const api = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
  withCredentials: true,  // 关键：跨域请求携带 Cookie（配合 httpOnly Cookie 方案）
})

// ✅ 不再设置 Authorization Header，Token 完全由 httpOnly Cookie 提供
api.interceptors.request.use(config => config)

// 401 统一处理：清除 Cookie 并跳转登录
// （Cookie 由后端 setAuthCookie 设置，后端 logout 时已清除，
//   此处兜底防止服务端 Cookie 已过期但前端未感知的情况）
api.interceptors.response.use(r => r.data, err => {
  if (err.response?.status === 401) {
    // 明确告知浏览器清除 token cookie（后端 logout 已清，此处双保险）
    document.cookie = 'vcc_token=; Max-Age=0; path=/';
    // 避免在 /login /register /forgot-password 页面重复跳转导致死循环
    const publicPaths = ['/login', '/register', '/forgot-password']
    const isPublicRoute = publicPaths.some(p => window.location.pathname.startsWith(p))
    if (!isPublicRoute) {
      // 非 public routes：跳转登录页（页面会刷新，Promise 不会停留）
      window.location.href = '/login'
      return new Promise(() => {}) // 跳转后页面刷新，Promise 不会停留
    }
    // ✅ FIX: public routes 上必须 reject，否则调用方的 finally/setLoading 永远不执行
    // 场景：App.tsx checkAuth() 在 /login 页面调 getUserInfo() → 401 → 必须让 finally 跑到
    return Promise.reject(err)
  }
  return Promise.reject(err)
})

// ── Auth ─────────────────────────────────────────────────────────────────────
export const sendSms = (phone: string) => api.post('/auth/send-sms', { phone })
export const sendEmail = (email: string) => api.post('/auth/send-email', { email })
export const register = (data: any) => api.post('/auth/register', data)
export const login = (account: string, password: string) =>
  // 后端 login 成功后写入 httpOnly Cookie，前端无需手动存储
  api.post('/auth/login', { account, password })
export const logout = () => {
  // 后端 logout 会清除 httpOnly Cookie，前端跳转由响应拦截器处理
  return api.post('/auth/logout').finally(() => {
    window.location.href = '/login'
  })
}
export const getUserInfo = () => api.get('/auth/me')
export const resetPassword = (account: string, code: string, newPassword: string) =>
  api.post('/auth/reset-password', { account, code, newPassword })

// ── Cards ────────────────────────────────────────────────────────────────────
export const getCards = (params?: any) => api.get('/cards', { params })
export const getAvailableCardBins = () => api.get('/cards/bins/available')
export const createCard = (data: any) => api.post('/cards', data)
export const getCardDetail = (id: number) => api.get(`/cards/${id}`)
// Secure iFrame 模式: UQPay 渠道通过 /pan-token 获取 iframeUrl，嵌入页面安全展示卡号
export const getPanToken = (id: number) => api.get<{
  iframeUrl: string;
  cardId: string;
  expiresIn: number;   // 秒，60
  expiresAt: string;  // ISO 8601
}>(`/cards/${id}/pan-token`)
export const revealCard = (id: number) => api.get(`/cards/${id}/reveal`)
export const topupCard = (id: number, amount: number) => api.post(`/cards/${id}/topup`, { amount })
export const freezeCard = (id: number) => api.post(`/cards/${id}/freeze`)
export const unfreezeCard = (id: number) => api.post(`/cards/${id}/unfreeze`)
export const cancelCard = (id: number) => api.post(`/cards/${id}/cancel`)

// ── 卡片备注 ─────────────────────────────────────────────────────────────────
export const updateCardRemark = (id: number, remark: string) => api.patch(`/cards/${id}/remark`, { remark })

// ── 使用到期时间 ─────────────────────────────────────────────────────────────
export const setCardUsageExpiry = (id: number, preset: string) => api.patch(`/cards/${id}/usage-expiry`, { preset })

// ── 卡片详情弹窗 ─────────────────────────────────────────────────────────────
export const getCardEnhancedDetail = (id: number) => api.get(`/cards/${id}/detail`)
export const getCardTransactions = (id: number, params: any) => api.get(`/cards/${id}/transactions`, { params })
export const getCardOperations = (id: number, params: any) => api.get(`/cards/${id}/operations`, { params })

// ── Transactions ─────────────────────────────────────────────────────────────
export const getTransactions = (params: any) => api.get('/transactions', { params })
export const getTransactionDetail = (id: number) => api.get(`/transactions/${id}`)

// ── Bills ────────────────────────────────────────────────────────────────────
export const getBills = () => api.get('/bills')
export const getBillDetail = (id: number) => api.get(`/bills/${id}`)
export const getBillStatistics = () => api.get('/bills/statistics/overview')

// ── Notices ──────────────────────────────────────────────────────────────────
export const getNotices = (page = 1, pageSize = 10) => api.get('/notices', { params: { page, pageSize } })

// ── KYC ──────────────────────────────────────────────────────────────────────
export const getKycStatus = () => api.get('/kyc/status')
export const submitKyc = (data: any) => api.post('/kyc/submit', data)

// ── Upload ───────────────────────────────────────────────────────────────────
export const uploadImage = (base64: string) => api.post('/upload/image', { base64 })

// ── Wallet ───────────────────────────────────────────────────────────────────
export const getWalletInfo = () => api.get('/wallet/info')
export const getWalletStats = () => api.get('/wallet/stats')
export const getWalletAddress = (network: string) => api.get('/wallet/address', { params: { network } })
export const getDepositList = (params: any) => api.get('/wallet/deposits', { params })
export const getDepositDetail = (id: number) => api.get(`/wallet/deposits/${id}`)
export const createC2COrder = (data: any) => api.post('/wallet/deposit/c2c', data)
export const getWalletRecords = (params: any) => api.get('/wallet/records', { params })
export const checkDepositStatus = (orderNo: string) => api.get(`/wallet/deposit/${orderNo}/status`)

// ── Wallet USDT→USD Conversion ────────────────────────────────────────
export const createWalletConvert = (data: any, idempotencyKey?: string) =>
  api.post('/wallet/convert/usdt-to-usd', data, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  })
export const getConversionRecords = (params: any) => api.get('/wallet/convert/records', { params })
export const getDepositConfig = () => api.get('/wallet/deposit/config')

// ── Account ──────────────────────────────────────────────────────────────────
export const changePassword = (oldPassword: string, newPassword: string) =>
  api.post('/auth/change-password', { oldPassword, newPassword })

// ── Dashboard Analytics ──────────────────────────────────────────────────────
export const getDashboardOverview = (params: any) => api.get('/dashboard/overview', { params })
export const getTransactionTrend = (params: any) => api.get('/dashboard/transaction-trend', { params })
export const getStatusBreakdown = (params: any) => api.get('/dashboard/status-breakdown', { params })
export const getFailureReasons = (params: any) => api.get('/dashboard/failure-reasons', { params })
export const getRecentTransactions = (params: any) => api.get('/dashboard/recent-transactions', { params })

// ── 持卡人邮箱 ────────────────────────────────────────────────────────
export const updateCardholderEmail = (cardId: number, email: string) =>
  api.patch(`/cards/${cardId}/cardholder-email`, { email })

export default api
