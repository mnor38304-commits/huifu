import { useState, useEffect } from 'react'
import { Row, Col, Card, Statistic, Table, Tag, Spin, Empty, Select, Space, Button, Carousel, List } from 'antd'
import {
  CreditCardOutlined, WalletOutlined, LockOutlined, PlusOutlined,
  FileTextOutlined, SwapOutlined, BellOutlined, ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getCards, getBillStatistics, getNotices } from '../services/api'
import {
  getDashboardOverview, getTransactionTrend, getStatusBreakdown,
  getFailureReasons, getRecentTransactions,
} from '../services/api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<any[]>([])
  const [statistics, setStatistics] = useState<any>({})
  const [notices, setNotices] = useState<any[]>([])
  const [overview, setOverview] = useState<any>(null)
  const [trend, setTrend] = useState<any[]>([])
  const [breakdown, setBreakdown] = useState<any[]>([])
  const [failureReasons, setFailureReasons] = useState<any[]>([])
  const [recentTxns, setRecentTxns] = useState<any[]>([])

  // 筛选条件
  const [range, setRange] = useState('30d')
  const [filterCardId, setFilterCardId] = useState<number | undefined>(undefined)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    loadAnalytics()
  }, [range, filterCardId])

  const loadData = async () => {
    try {
      const [cardsRes, statsRes, noticesRes] = await Promise.all([
        getCards(),
        getBillStatistics(),
        getNotices(1, 5)
      ])
      if (cardsRes.code === 0) setCards(cardsRes.data || [])
      if (statsRes.code === 0) setStatistics(statsRes.data || {})
      if (noticesRes.code === 0) setNotices(noticesRes.data?.list || [])
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const loadAnalytics = async () => {
    setAnalyticsLoading(true)
    const params: any = { range }
    if (filterCardId) params.card_id = filterCardId
    try {
      const [overviewRes, trendRes, breakdownRes, failureRes, recentRes] = await Promise.all([
        getDashboardOverview(params),
        getTransactionTrend(params),
        getStatusBreakdown(params),
        getFailureReasons(params),
        getRecentTransactions({ ...params, limit: 10 }),
      ])
      if (overviewRes.code === 0) setOverview(overviewRes.data)
      if (trendRes.code === 0) setTrend(Array.isArray(trendRes.data) ? trendRes.data : [])
      if (breakdownRes.code === 0) setBreakdown(Array.isArray(breakdownRes.data) ? breakdownRes.data : [])
      if (failureRes.code === 0) setFailureReasons(Array.isArray(failureRes.data) ? failureRes.data : [])
      if (recentRes.code === 0) setRecentTxns(Array.isArray(recentRes.data) ? recentRes.data : [])
    } catch (e) {
      console.error(e)
    } finally {
      setAnalyticsLoading(false)
    }
  }

  const totalBalance = cards.reduce((sum, card) => sum + (card.status === 1 ? card.balance : 0), 0)
  const frozenBalance = cards.reduce((sum, card) => sum + (card.status === 2 ? card.balance : 0), 0)
  const activeCards = cards.filter(card => card.status === 1).length

  const quickActions = [
    { key: '/cards', icon: <PlusOutlined />, title: '开卡', color: '#1890ff' },
    { key: '/cards', icon: <WalletOutlined />, title: '充值', color: '#52c41a' },
    { key: '/bills', icon: <FileTextOutlined />, title: '账单', color: '#faad14' },
    { key: '/transactions', icon: <SwapOutlined />, title: '交易', color: '#722ed1' },
  ]

  const statusMap: Record<number, { text: string; color: string }> = {
    1: { text: '正常', color: 'green' },
    2: { text: '冻结', color: 'orange' },
    3: { text: '已过期', color: 'red' },
    4: { text: '已注销', color: 'default' },
  }

  const txnStatusMap: Record<string, { text: string; color: string }> = {
    SUCCESS: { text: '成功', color: 'green' },
    FAILED: { text: '失败', color: 'red' },
    REFUND: { text: '退款', color: 'orange' },
    PENDING: { text: '处理中', color: 'blue' },
  }

  const PIE_COLORS = ['#52c41a', '#ff4d4f', '#faad14', '#1890ff']

  const hasData = overview && overview.totalTransactions > 0

  const statusLabel = (status: number) => {
    const s = txnStatusMap[status === 1 ? 'SUCCESS' : status === 2 ? 'FAILED' : status === 3 ? 'REFUND' : 'PENDING']
    return s ? <Tag color={s.color}>{s.text}</Tag> : <Tag>{status}</Tag>
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
  }

  return (
    <div>
      <h2 style={{ marginBottom: 24 }}>账户概览</h2>

      {/* 轮播公告 */}
      {notices.length > 0 && (
        <Carousel autoplay style={{ marginBottom: 24 }}>
          {notices.map((notice, idx) => (
            <div key={idx}>
              <div style={{ background: '#e6f7ff', padding: '12px 16px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <BellOutlined style={{ color: '#1890ff' }} />
                <span>{notice.title}</span>
                <span style={{ color: '#999', marginLeft: 'auto' }}>{notice.created_at?.split('T')[0]}</span>
              </div>
            </div>
          ))}
        </Carousel>
      )}

      {/* 余额卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="账户总余额 (USD)"
              value={totalBalance + frozenBalance}
              precision={2}
              prefix={<WalletOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="可用余额 (USD)"
              value={totalBalance}
              precision={2}
              prefix={<CreditCardOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="冻结金额 (USD)"
              value={frozenBalance}
              precision={2}
              prefix={<LockOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 待处理事项 + 快捷操作（原有） */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="待处理事项">
            <List
              size="small"
              dataSource={[
                ...(activeCards === 0 ? ['请创建您的第一张卡片'] : []),
                ...(activeCards > 0 && !hasData ? ['暂无交易数据，尝试充值并消费'] : []),
              ]}
              renderItem={(item: any) => (
                <List.Item><span>{item}</span></List.Item>
              )}
            />
          </Card>
        </Col>
        <Col span={12}>
          {/* 筛选控件 */}
          <Card title="数据分析筛选" size="small" style={{ marginBottom: 0 }}>
            <Space wrap>
              <Select value={range} onChange={setRange} style={{ width: 120 }}>
                <Select.Option value="today">今日</Select.Option>
                <Select.Option value="7d">近 7 天</Select.Option>
                <Select.Option value="30d">近 30 天</Select.Option>
                <Select.Option value="month">本月</Select.Option>
              </Select>
              <Select
                value={filterCardId}
                onChange={setFilterCardId}
                style={{ width: 140 }}
                allowClear
                placeholder="全部卡片"
              >
                {cards.map(c => (
                  <Select.Option key={c.id} value={c.id}>{c.card_no_masked}</Select.Option>
                ))}
              </Select>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 快捷操作 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {quickActions.map(action => (
          <Col span={6} key={action.key}>
            <Card hoverable onClick={() => navigate(action.key)} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, color: action.color, marginBottom: 8 }}>
                {action.icon}
              </div>
              <div>{action.title}</div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 分析面板 */}
      <Spin spinning={analyticsLoading}>
        {/* 概览统计卡片 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {hasData ? (
            <>
              <Col span={4}>
                <Card size="small"><Statistic title="总交易" value={overview.totalTransactions} suffix="笔" /></Card>
              </Col>
              <Col span={4}>
                <Card size="small"><Statistic title="总金额" value={overview.totalAmount} precision={2} prefix="$" /></Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="成功率" value={overview.successRate} precision={1} suffix="%" valueStyle={{ color: '#52c41a' }} prefix={<ArrowUpOutlined />} />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="失败率" value={overview.failureRate} precision={1} suffix="%" valueStyle={{ color: '#ff4d4f' }} prefix={<ArrowDownOutlined />} />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="退款率" value={overview.refundRate} precision={1} suffix="%" valueStyle={{ color: '#faad14' }} />
                </Card>
              </Col>
              <Col span={4}>
                <Card size="small">
                  <Statistic title="授权成功率" value={overview.verifiedRate} precision={1} suffix="%" valueStyle={{ color: '#1890ff' }} />
                </Card>
              </Col>
            </>
          ) : (
            <Col span={24}>
              <Card><Empty description="暂无交易数据" /></Card>
            </Col>
          )}
        </Row>

        {/* 交易趋势 + 状态占比 */}
        {hasData && (
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={16}>
              <Card title="交易趋势" size="small">
                {trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Line type="monotone" dataKey="amount" stroke="#1890ff" name="金额(USD)" strokeWidth={2} />
                      <Line type="monotone" dataKey="success" stroke="#52c41a" name="成功" />
                      <Line type="monotone" dataKey="failed" stroke="#ff4d4f" name="失败" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <Empty description="暂无趋势数据" />}
              </Card>
            </Col>
            <Col span={8}>
              <Card title="状态占比" size="small">
                {breakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={breakdown} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={({ status, count }) => `${status}: ${count}`}>
                        {breakdown.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <Empty description="暂无数据" />}
              </Card>
            </Col>
          </Row>
        )}

        {/* 失败原因 + 最近交易 */}
        {hasData && (
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Card title="失败原因 Top" size="small">
                {failureReasons.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={failureReasons} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" fontSize={11} />
                      <YAxis type="category" dataKey="reason" width={80} fontSize={11} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#ff4d4f" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty description="暂无失败交易" />}
              </Card>
            </Col>
            <Col span={16}>
              <Card title="最近交易" size="small" extra={<a onClick={() => navigate('/transactions')}>查看全部</a>}>
                <Table
                  dataSource={recentTxns}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 140, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
                    { title: '卡号', dataIndex: 'card_masked', key: 'card_masked', width: 100 },
                    { title: '金额', dataIndex: 'amount', key: 'amount', width: 80, render: (v: number) => `$${(v || 0).toFixed(2)}` },
                    { title: '币种', dataIndex: 'currency', key: 'currency', width: 60 },
                    { title: '状态', dataIndex: 'status', key: 'status', width: 70, render: (v: number) => statusLabel(v) },
                    { title: '商户', dataIndex: 'merchant', key: 'merchant', width: 120, render: (v: string) => v || '-' },
                    { title: '类型', dataIndex: 'type', key: 'type', width: 80 },
                  ]}
                />
              </Card>
            </Col>
          </Row>
        )}
      </Spin>

      {/* 卡片列表预览（原有） */}
      <Card title="我的卡片" extra={<a onClick={() => navigate('/cards')}>查看全部</a>}>
        <Row gutter={16}>
          {cards.slice(0, 4).map(card => (
            <Col span={6} key={card.id}>
              <Card
                size="small"
                hoverable
                onClick={() => navigate(`/cards/${card.id}`)}
                style={{
                  background: card.status === 1 ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#f5f5f5',
                  color: card.status === 1 ? '#fff' : '#666'
                }}
              >
                <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.8 }}>{card.card_name}</div>
                <div style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>{card.card_no_masked}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span>${card.balance?.toFixed(2)}</span>
                  <Tag color={statusMap[card.status]?.color}>{statusMap[card.status]?.text}</Tag>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
    </div>
  )
}

export default Dashboard
