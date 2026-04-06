import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Avatar, Dropdown, Badge, theme } from 'antd'
import {
  DashboardOutlined, TeamOutlined, CreditCardOutlined, SwapOutlined,
  DollarOutlined, SettingOutlined, LogoutOutlined, UserOutlined,
  BellOutlined, SafetyOutlined, FileTextOutlined, ApiOutlined, AuditOutlined,
  WalletOutlined
} from '@ant-design/icons'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Merchants from './pages/Merchants'
import KycAudit from './pages/KycAudit'
import CardBins from './pages/CardBins'
import CardList from './pages/CardList'
import Channels from './pages/Channels'
import UsdtOrders from './pages/UsdtOrders'
import Transactions from './pages/Transactions'
import Notices from './pages/Notices'
import AdminLogs from './pages/AdminLogs'
import WalletManagement from './pages/WalletManagement'
import { getAdminInfo } from './api'

const { Header, Sider, Content } = Layout

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '控制台' },
  {
    key: 'merchant', icon: <TeamOutlined />, label: '商户管理',
    children: [
      { key: '/merchants', label: '商户列表' },
      { key: '/wallet', label: '钱包管理', icon: <WalletOutlined /> },
      { key: '/kyc-audit', label: 'KYC审核', icon: <AuditOutlined /> },
    ]
  },
  {
    key: 'card', icon: <CreditCardOutlined />, label: '卡片管理',
    children: [
      { key: '/card-bins', label: 'BIN费率设置' },
      { key: '/cards', label: '卡片列表' },
      { key: '/channels', label: '渠道对接', icon: <ApiOutlined /> },
    ]
  },
  { key: '/usdt', icon: <DollarOutlined />, label: 'USDT充值' },
  { key: '/transactions', icon: <SwapOutlined />, label: '交易流水' },
  { key: '/notices', icon: <BellOutlined />, label: '公告管理' },
  { key: '/logs', icon: <FileTextOutlined />, label: '操作日志' },
]

export default function App() {
  const [admin, setAdmin] = useState<any>(null)
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { token: { colorBgContainer } } = theme.useToken()

  useEffect(() => {
    const t = localStorage.getItem('admin_token')
    if (t) {
      getAdminInfo().then((r: any) => {
        if (r.code === 0) setAdmin(r.data)
        else { localStorage.removeItem('admin_token'); navigate('/login') }
      }).catch(() => navigate('/login'))
    }
  }, [])

  const logout = () => { localStorage.removeItem('admin_token'); navigate('/login') }

  if (!admin && !localStorage.getItem('admin_token')) {
    return <Routes>
      <Route path="/login" element={<Login onLogin={setAdmin} />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  }

  const roleColors: Record<string, string> = { super: '#f50', admin: '#2db7f5', operator: '#87d068', finance: '#108ee9' }
  const roleLabels: Record<string, string> = { super: '超级管理员', admin: '管理员', operator: '运营', finance: '财务' }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={220}
        style={{ background: '#001529' }}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 8 }}>
          {collapsed
            ? <span style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>V</span>
            : <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>💳 VCC 管理后台</div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>Virtual Card System</div>
              </div>
          }
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]}
          defaultOpenKeys={['merchant', 'card']}
          onClick={({ key }) => navigate(key)} items={menuItems} />
      </Sider>

      <Layout>
        <Header style={{ padding: '0 24px', background: colorBgContainer, display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: 15, color: '#666' }}>
            {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Badge count={0}><BellOutlined style={{ fontSize: 18, cursor: 'pointer' }} /></Badge>
            <Dropdown menu={{ items: [
              { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout }
            ]}}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <Avatar style={{ background: roleColors[admin?.role] || '#1890ff' }} icon={<UserOutlined />} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{admin?.real_name || admin?.username}</div>
                  <div style={{ fontSize: 11, color: roleColors[admin?.role] }}>{roleLabels[admin?.role]}</div>
                </div>
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content style={{ margin: 16, padding: 24, background: '#f0f2f5', minHeight: 280, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/merchants" element={<Merchants />} />
            <Route path="/kyc-audit" element={<KycAudit />} />
            <Route path="/card-bins" element={<CardBins />} />
            <Route path="/cards" element={<CardList />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/usdt" element={<UsdtOrders />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/wallet" element={<WalletManagement />} />
            <Route path="/notices" element={<Notices />} />
            <Route path="/logs" element={<AdminLogs />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}
