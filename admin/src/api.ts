import axios from 'axios'

const BASE = axios.create({ baseURL: '/api/admin', timeout: 10000 })

BASE.interceptors.request.use(config => {
  const t = localStorage.getItem('admin_token')
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})
BASE.interceptors.response.use(r => r.data, err => {
  if (err.response?.status === 401) {
    localStorage.removeItem('admin_token')
    window.location.href = '/login'
  }
  return Promise.reject(err)
})

export const login = (u, p) => BASE.post('/auth/login', { username: u, password: p })
export const getAdminInfo = () => BASE.get('/auth/me')
export const getDashboard = () => BASE.get('/dashboard/stats')
export const getMerchants = p => BASE.get('/merchants', { params: p })
export const getMerchantDetail = id => BASE.get(`/merchants/${id}`)
export const getMerchantBinPermissions = id => BASE.get(`/merchants/${id}/bin-permissions`)
export const updateMerchantBinPermissions = (id, binIds) => BASE.post(`/merchants/${id}/bin-permissions`, { binIds })
export const setMerchantStatus = (id, s) => BASE.post(`/merchants/${id}/status`, { status: s })
export const getKycPending = p => BASE.get('/merchants/kyc/pending', { params: p })
export const auditKyc = (id, a, r) => BASE.post(`/merchants/kyc/${id}/audit`, { action: a, rejectReason: r })
export const getBins = p => BASE.get('/cards/bins', { params: p })
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
export const getUsdtOrders = p => BASE.get('/usdt/orders', { params: p })
export const confirmUsdt = (id, tx) => BASE.post(`/usdt/orders/${id}/confirm`, { txHash: tx })
export const getUsdtStats = () => BASE.get('/usdt/stats')
// USDT充值相关
export const getUsdtAddress = (network: string) => BASE.get('/usdt/address', { params: { network } })
export const syncUsdtOrder = (id: number) => BASE.post(`/usdt/orders/${id}/sync`)
export const getUsdtOrderDetail = (id: number) => BASE.get(`/usdt/orders/${id}/detail`)
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

export default BASE
