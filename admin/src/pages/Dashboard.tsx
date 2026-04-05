import { useState, useEffect } from 'react'
import { Row, Col, Card, Statistic, Table, Tag, Spin } from 'antd'
import { TeamOutlined, CreditCardOutlined, SwapOutlined, DollarOutlined, RiseOutlined, SafetyOutlined } from '@ant-design/icons'
import { getDashboard } from '../api'

export default function Dashboard() {
  const [data, setData] = useState<any>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDashboard().then((r: any) => { if (r.code === 0) setData(r.data) }).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>

  const statCards = [
    { title: '总商户数', value: data.totalUsers, sub: `活跃 ${data.activeUsers}`, icon: <TeamOutlined />, color: '#1890ff' },
    { title: '总卡片数', value: data.totalCards, sub: `正常 ${data.activeCards}`, icon: <CreditCardOutlined />, color: '#52c41a' },
    { title: '今日交易笔数', value: data.totalTxnToday, sub: `金额 $${(data.totalVolToday||0).toFixed(2)}`, icon: <SwapOutlined />, color: '#faad14' },
    { title: '今日手续费', value: `$${(data.totalFeeToday||0).toFixed(2)}`, sub: `待审KYC ${data.kycPending}`, icon: <DollarOutlined />, color: '#722ed1' },
    { title: '账户总余额', value: `$${(data.totalBalance||0).toFixed(2)}`, sub: `USDT待确认 ${data.pendingUsdt}`, icon: <RiseOutlined />, color: '#13c2c2' },
  ]

  const weekCols = [
    { title: '日期', dataIndex: 'day', key: 'day' },
    { title: '交易笔数', dataIndex: 'count', key: 'count' },
    { title: '交易金额', dataIndex: 'volume', key: 'volume', render: (v: number) => `$${v?.toFixed(2)}` },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 20 }}>控制台</h2>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((s, i) => (
          <Col span={Math.floor(24 / statCards.length)} key={i}>
            <Card bodyStyle={{ padding: '20px 24px' }} style={{ borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>{s.title}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>{s.sub}</div>
                </div>
                <div style={{ fontSize: 32, color: s.color, opacity: 0.2 }}>{s.icon}</div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={16}>
        <Col span={16}>
          <Card title="近7天交易趋势" style={{ borderRadius: 8 }}>
            <Table columns={weekCols} dataSource={data.weeklyTxn || []} rowKey="day" pagination={false} size="small" />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="快速入口" style={{ borderRadius: 8 }}>
            {[
              { label: '待审核KYC', value: data.kycPending, color: '#faad14', path: '/kyc-audit' },
              { label: '待确认USDT', value: data.pendingUsdt, color: '#1890ff', path: '/usdt' },
              { label: '活跃卡片', value: data.activeCards, color: '#52c41a', path: '/cards' },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < 2 ? '1px solid #f0f0f0' : 'none' }}>
                <span style={{ color: '#666' }}>{item.label}</span>
                <Tag color={item.color} style={{ cursor: 'pointer' }} onClick={() => window.location.href = item.path}>{item.value}</Tag>
              </div>
            ))}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
