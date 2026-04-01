import axios from 'axios'

const BASE = axios.create({ baseURL: '/admin/api', timeout: 10000 })

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
export const setMerchantStatus = (id, s) => BASE.post(`/merchants/${id}/status`, { status: s })
export const getKycPending = p => BASE.get('/merchants/kyc/pending', { params: p })
export const auditKyc = (id, a, r) => BASE.post(`/merchants/kyc/${id}/audit`, { action: a, rejectReason: r })
export const getBins = p => BASE.get('/cards/bins', { params: p })
export const createBin = d => BASE.post('/cards/bins', d)
export const updateBin = (id, d) => BASE.put(`/cards/bins/${id}`, d)
export const getCards = p => BASE.get('/cards/cards', { params: p })
export const setCardStatus = (id, s, r) => BASE.post(`/cards/cards/${id}/status`, { status: s, reason: r })
export const getChannels = () => BASE.get('/cards/channels')
export const createChannel = d => BASE.post('/cards/channels', d)
export const updateChannel = (id, d) => BASE.put(`/cards/channels/${id}`, d)
export const getUsdtOrders = p => BASE.get('/usdt/orders', { params: p })
export const confirmUsdt = (id, tx) => BASE.post(`/usdt/orders/${id}/confirm`, { txHash: tx })
export const getUsdtStats = () => BASE.get('/usdt/stats')
export const getTransactions = p => BASE.get('/ops', { params: p })
export const getTxnStats = () => BASE.get('/ops/stats')
export const getNotices = () => BASE.get('/ops/notices')
export const createNotice = d => BASE.post('/ops/notices', d)
export const updateNotice = (id, d) => BASE.put(`/ops/notices/${id}`, d)
export const deleteNotice = id => BASE.delete(`/ops/notices/${id}`)
export const getLogs = p => BASE.get('/ops/logs', { params: p })

export default BASE
