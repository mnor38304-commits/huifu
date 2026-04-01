import axios from 'axios'

const api = axios.create({ 
  baseURL: '/admin/api', 
  timeout: 10000 
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(r => r.data, err => {
  if (err.response?.status === 401) {
    localStorage.removeItem('admin_token')
    window.location.href = '/login'
  }
  return Promise.reject(err)
})

export const login = (u: string, p: string) => api.post('/auth/login', { username: u, password: p })
export const getAdminInfo = () => api.get('/auth/me')
export const getDashboard = () => api.get('/dashboard/stats')
export const getMerchants = (p: any) => api.get('/merchants', { params: p })
export const getMerchantDetail = (id: number) => api.get(`/merchants/${id}`)
export const setMerchantStatus = (id: number, s: number) => api.post(`/merchants/${id}/status`, { status: s })
export const getKycPending = (p: any) => api.get('/merchants/kyc/pending', { params: p })
export const auditKyc = (id: number, a: string, r?: string) => api.post(`/merchants/kyc/${id}/audit`, { action: a, rejectReason: r })
export const getBins = (p: any) => api.get('/cards/bins', { params: p })
export const createBin = (d: any) => api.post('/cards/bins', d)
export const updateBin = (id: number, d: any) => api.put(`/cards/bins/${id}`, d)
export const getCards = (p: any) => api.get('/cards/cards', { params: p })
export const setCardStatus = (id: number, s: number, r?: string) => api.post(`/cards/cards/${id}/status`, { status: s, reason: r })
export const getChannels = () => api.get('/cards/channels')
export const createChannel = (d: any) => api.post('/cards/channels', d)
export const updateChannel = (id: number, d: any) => api.put(`/cards/channels/${id}`, d)
export const getUsdtOrders = (p: any) => api.get('/usdt/orders', { params: p })
export const confirmUsdt = (id: number, tx?: string) => api.post(`/usdt/orders/${id}/confirm`, { txHash: tx })
export const getUsdtStats = () => api.get('/usdt/stats')
export const getTransactions = (p: any) => api.get('/ops', { params: p })
export const getTxnStats = () => api.get('/ops/stats')
export const getNotices = () => api.get('/ops/notices')
export const createNotice = (d: any) => api.post('/ops/notices', d)
export const updateNotice = (id: number, d: any) => api.put(`/ops/notices/${id}`, d)
export const deleteNotice = (id: number) => api.delete(`/ops/notices/${id}`)
export const getLogs = (p: any) => api.get('/ops/logs', { params: p })

export default api
