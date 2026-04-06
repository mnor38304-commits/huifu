import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Layout, Menu, theme } from 'antd'
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
import Dashboard from './pages/Dashboard'
import Cards from './pages/Cards'
import CardDetail from './pages/CardDetail'
import Transactions from './pages/Transactions'
import Bills from './pages/Bills'
import Wallet from './pages/Wallet'
import Settings from './pages/Settings'
import { getUserInfo } from './services/api'

const { Header, Sider, Content } = Layout

const App: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState<any>(null)
  const navigate = useNavigate()
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      getUserInfo().then(res => {
        if (res.code === 0) {
          setUser(res.data)
        } else {
          localStorage.removeItem('token')
        }
      }).catch(() => {
        localStorage.removeItem('token')
      })
    }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('token')
    navigate('/login')
  }

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '账户概览' },
    { key: '/wallet', icon: <WalletOutlined />, label: '钱包' },
    { key: '/cards', icon: <CreditCardOutlined />, label: 'VCC卡片' },
    { key: '/transactions', icon: <SwapOutlined />, label: '交易查询' },
    { key: '/bills', icon: <FileTextOutlined />, label: '账单中心' },
    { key: '/settings', icon: <SettingOutlined />, label: '设置' },
  ]

  // 未登录时只显示登录页面
  if (!user && !localStorage.getItem('token')) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={setUser} />} />
        <Route path="/register" element={<Register />} />
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
            <LogoutOutlined style={{ cursor: 'pointer' }} onClick={handleLogout} />
          </div>
        </Header>
        <Content style={{ margin: 16, padding: 24, background: colorBgContainer, borderRadius: borderRadiusLG, minHeight: 280, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/cards" element={<Cards />} />
            <Route path="/cards/:id" element={<CardDetail />} />
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