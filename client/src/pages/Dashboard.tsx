import { useState, useEffect } from 'react'
import { Row, Col, Card, Statistic, List, Tag, Button, Carousel, Spin } from 'antd'
import { 
  CreditCardOutlined, 
  WalletOutlined, 
  LockOutlined, 
  PlusOutlined,
  FileTextOutlined,
  SwapOutlined,
  BellOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getCards, getBillStatistics, getNotices } from '../services/api'

const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<any[]>([])
  const [statistics, setStatistics] = useState<any>({})
  const [notices, setNotices] = useState<any[]>([])

  useEffect(() => {
    loadData()
  }, [])

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

      {/* 待处理事项 */}
      <Card title="待处理事项" style={{ marginBottom: 24 }}>
        <List
          size="small"
          dataSource={[
            ...(statistics.currentBill?.total_spend > 0 ? [] : ['本月暂无消费记录']),
            ...(activeCards === 0 ? ['请创建您的第一张卡片'] : []),
          ]}
          renderItem={(item: any) => (
            <List.Item>
              <span>{item}</span>
            </List.Item>
          )}
        />
      </Card>

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

      {/* 卡片列表预览 */}
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
                  <span>${card.balance.toFixed(2)}</span>
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