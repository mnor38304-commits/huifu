import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Layout, Menu, theme, message } from 'antd'
import {
  DashboardOutlined,
  CreditCardOutlined,
  SwapOutlined,
  FileTextOutlined,
  SettingOutlined,
  LogoutOutlined,
  BellOutlined,
  UserOutlined,
  WalletOutlined
} from '@ant-design/icons'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import Dashboard from './pages/Dashboard'
import Cards from './pages/Cards'
import Cardholders from './pages/Cardholders'
import CardDetail from './pages/CardDetail'
import Transactions from './pages/Transactions'
import Bills from './pages/Bills'
import Wallet from './pages/Wallet'
import Settings from './pages/Settings'
import { getUserInfo, logout } from './services/api'

const { Header, Sider, Content } = Layout

const App: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()

  // ✅ FIX: 移除 localStorage 依赖，改为直接调用 getUserInfo() 验证 httpOnly Cookie
  // httpOnly Cookie 由浏览器自动随请求发送，无需前端手动管理
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res: any = await getUserInfo()
        if (res.code === 0) {
          setUser(res.data)
        } else {
          // 获取用户信息失败，说明未登录或 token 已过期
          setUser(null)
        }
      } catch (error: any) {
        // 网络错误或 401 未授权，都表示未登录
        console.error('Auth check failed:', error.message)
        setUser(null)
      } finally {
        setLoading(false)
      }
    }

    checkAuth()
  }, [])

  const handleLogout = async () => {
    try {
      await logout()
      // logout() 已经处理了跳转，这里作为兜底
      setUser(null)
      message.success('已登出')
    } catch (error) {
      console.error('Logout error:', error)
      // 即使登出失败，也清除本地状态并跳转
      setUser(null)
      message.warning('登出失败，请重新登录')
      navigate('/login')
    }
  }

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '账户概览' },
    { key: '/wallet', icon: <WalletOutlined />, label: '钱包' },
    { key: '/cards', icon: <CreditCardOutlined />, label: 'VCC卡片' },
    { key: '/cardholders', icon: <UserOutlined />, label: '持卡人管理' },
    { key: '/transactions', icon: <SwapOutlined />, label: '交易查询' },
    { key: '/bills', icon: <FileTextOutlined />, label: '账单中心' },
    { key: '/settings', icon: <SettingOutlined />, label: '设置' },
  ]

  // 加载中显示空白
  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div>加载中...</div>
    </div>
  }

  // 未登录时只显示登录页面
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={setUser} />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}>
        <div style={{ height: 32, margin: 16, background: 'rgba(255, 255, 255, 0.2)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold' }}>
          {collapsed ? 'VCC' : '虚拟卡系统'}
        </div>
        <Menu 
          theme="dark" 
          mode="inline" 
          defaultSelectedKeys={['/']}
          onClick={({ key }) => navigate(key)}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: '0 24px', background: colorBgContainer, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 500 }}>
            {user?.user_no}
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} />
            <span><UserOutlined /> {user?.phone || user?.email}</span>
            <LogoutOutlined style={{ cursor: 'pointer' }} onClick={handleLogout} title="登出" />
          </div>
        </Header>
        <Content style={{ margin: 16, padding: 24, background: colorBgContainer, borderRadius: borderRadiusLG, minHeight: 280, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/cards" element={<Cards />} />
            <Route path="/cards/:id" element={<CardDetail />} />
            <Route path="/cardholders" element={<Cardholders />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

export default App
