import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 10000
})

// 请求拦截器 - 添加Token
api.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => Promise.reject(error)
)

// 响应拦截器
api.interceptors.response.use(
  response => response.data,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Auth APIs
export const sendSms = (phone: string) => api.post('/auth/send-sms', { phone })
export const sendEmail = (email: string) => api.post('/auth/send-email', { email })
export const register = (data: { phone?: string; email?: string; password: string; code: string }) => api.post('/auth/register', data)
export const login = (account: string, password: string) => api.post('/auth/login', { account, password })
export const logout = () => api.post('/auth/logout')
export const getUserInfo = () => api.get('/auth/me')

// Card APIs
export const getCards = (status?: number) => api.get('/cards', { params: { status } })
export const createCard = (data: { cardName: string; cardType: string; creditLimit: number; singleLimit?: number; dailyLimit?: number; purpose?: string }) => api.post('/cards', data)
export const getCardDetail = (id: number) => api.get(`/cards/${id}`)
export const revealCard = (id: number) => api.get(`/cards/${id}/reveal`)
export const topupCard = (id: number, amount: number) => api.post(`/cards/${id}/topup`, { amount })
export const freezeCard = (id: number) => api.post(`/cards/${id}/freeze`)
export const unfreezeCard = (id: number) => api.post(`/cards/${id}/unfreeze`)
export const cancelCard = (id: number) => api.post(`/cards/${id}/cancel`)

// Transaction APIs
export const getTransactions = (params: { cardId?: number; txnType?: string; status?: number; startDate?: string; endDate?: string; keyword?: string; page?: number; pageSize?: number }) => 
  api.get('/transactions', { params })
export const getTransactionDetail = (id: number) => api.get(`/transactions/${id}`)

// Bill APIs
export const getBills = () => api.get('/bills')
export const getBillDetail = (id: number) => api.get(`/bills/${id}`)
export const getBillStatistics = () => api.get('/bills/statistics/overview')

// Notice APIs
export const getNotices = (page = 1, pageSize = 10) => api.get('/notices', { params: { page, pageSize } })

// KYC APIs
export const getKycStatus = () => api.get('/kyc/status')
export const submitKyc = (data: any) => api.post('/kyc/submit', data)

export default api