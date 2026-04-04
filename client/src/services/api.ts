import axios from 'axios'

const api = axios.create({ 
  baseURL: '/api/v1', 
  timeout: 10000 
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(r => r.data, err => {
  if (err.response?.status === 401) {
    localStorage.removeItem('token')
    window.location.href = '/login'
  }
  return Promise.reject(err)
})

export const sendSms = (phone: string) => api.post('/auth/send-sms', { phone })
export const sendEmail = (email: string) => api.post('/auth/send-email', { email })
export const register = (data: any) => api.post('/auth/register', data)
export const login = (account: string, password: string) => api.post('/auth/login', { account, password })
export const logout = () => api.post('/auth/logout')
export const getUserInfo = () => api.get('/auth/me')
export const getCards = (status?: number) => api.get('/cards', { params: { status } })
export const getAvailableCardBins = () => api.get('/cards/bins/available')
export const createCard = (data: any) => api.post('/cards', data)
export const getCardDetail = (id: number) => api.get(`/cards/${id}`)
export const revealCard = (id: number) => api.get(`/cards/${id}/reveal`)
export const topupCard = (id: number, amount: number) => api.post(`/cards/${id}/topup`, { amount })
export const freezeCard = (id: number) => api.post(`/cards/${id}/freeze`)
export const unfreezeCard = (id: number) => api.post(`/cards/${id}/unfreeze`)
export const cancelCard = (id: number) => api.post(`/cards/${id}/cancel`)
export const getTransactions = (params: any) => api.get('/transactions', { params })
export const getTransactionDetail = (id: number) => api.get(`/transactions/${id}`)
export const getBills = () => api.get('/bills')
export const getBillDetail = (id: number) => api.get(`/bills/${id}`)
export const getBillStatistics = () => api.get('/bills/statistics/overview')
export const getNotices = (page = 1, pageSize = 10) => api.get('/notices', { params: { page, pageSize } })
export const getKycStatus = () => api.get('/kyc/status')
export const submitKyc = (data: any) => api.post('/kyc/submit', data)

export default api
