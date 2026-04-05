import { useState, useEffect } from 'react'
import { Card, Row, Col, Button, Modal, InputNumber, message, Descriptions, Tag, Space, Divider, Spin } from 'antd'
import { WalletOutlined, LockOutlined, UnlockOutlined, DeleteOutlined, EyeOutlined, CopyOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { getCardDetail, revealCard, topupCard, freezeCard, unfreezeCard, cancelCard } from '../services/api'

const CardDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [card, setCard] = useState<any>(null)
  const [cardRevealed, setCardRevealed] = useState(false)
  const [revealLoading, setRevealLoading] = useState(false)
  const [topupModalVisible, setTopupModalVisible] = useState(false)
  const [topupAmount, setTopupAmount] = useState<number>(100)
  const [topupLoading, setTopupLoading] = useState(false)

  useEffect(() => {
    loadCardDetail()
  }, [id])

  const loadCardDetail = async () => {
    try {
      const res = await getCardDetail(Number(id))
      if (res.code === 0) {
        setCard(res.data)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleReveal = async () => {
    if (cardRevealed) {
      setCardRevealed(false)
      return
    }
    setRevealLoading(true)
    try {
      const res = await revealCard(Number(id))
      if (res.code === 0) {
        setCard({ ...card, ...res.data })
        setCardRevealed(true)
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '获取失败')
    } finally {
      setRevealLoading(false)
    }
  }

  const handleTopup = async () => {
    if (topupAmount <= 0) {
      message.error('请输入有效金额')
      return
    }
    setTopupLoading(true)
    try {
      const res = await topupCard(Number(id), topupAmount)
      if (res.code === 0) {
        message.success('充值成功')
        setTopupModalVisible(false)
        loadCardDetail()
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '充值失败')
    } finally {
      setTopupLoading(false)
    }
  }

  const handleFreeze = async (freeze: boolean) => {
    try {
      const res = freeze ? await freezeCard(Number(id)) : await unfreezeCard(Number(id))
      if (res.code === 0) {
        message.success(freeze ? '卡片已冻结' : '卡片已解冻')
        loadCardDetail()
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '操作失败')
    }
  }

  const handleCancel = async () => {
    try {
      const res = await cancelCard(Number(id))
      if (res.code === 0) {
        message.success('卡片已注销')
        navigate('/cards')
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '操作失败')
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  }

  const statusMap: Record<number, { text: string; color: string }> = {
    0: { text: '待激活', color: 'default' },
    1: { text: '正常', color: 'green' },
    2: { text: '冻结', color: 'orange' },
    3: { text: '已过期', color: 'red' },
    4: { text: '已注销', color: 'default' },
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
  }

  if (!card) {
    return <div>卡片不存在</div>
  }

  return (
    <div>
      <Button onClick={() => navigate('/cards')} style={{ marginBottom: 16 }}>← 返回卡片列表</Button>
      
      <Row gutter={24}>
        <Col span={12}>
          <Card 
            title={card.card_name}
            extra={<Tag color={statusMap[card.status]?.color}>{statusMap[card.status]?.text}</Tag>}
            style={{ 
              background: card.status === 1 ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '#f5f5f5',
              color: card.status === 1 ? '#fff' : '#666'
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 24, letterSpacing: 2 }}>
              {card.card_no_masked}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>有效期</div>
                <div style={{ fontSize: 18 }}>{cardRevealed ? card.expireDate : '**/**'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>CVV</div>
                <div style={{ fontSize: 18 }}>{cardRevealed ? card.cvv : '***'}</div>
              </div>
            </div>
            
            {cardRevealed && (
              <div style={{ background: 'rgba(255,255,255,0.2)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>完整卡号</div>
                <div style={{ fontSize: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {card.cardNo}
                  <CopyOutlined style={{ cursor: 'pointer' }} onClick={() => copyToClipboard(card.cardNo)} />
                </div>
              </div>
            )}
            
            <Button 
              type="primary" 
              ghost={card.status === 1}
              loading={revealLoading}
              onClick={handleReveal}
              block
            >
              {cardRevealed ? '隐藏卡片信息' : <><EyeOutlined /> 查看完整卡号</>}
            </Button>
          </Card>
        </Col>
        
        <Col span={12}>
          <Card title="卡片信息" style={{ marginBottom: 16 }}>
            <Descriptions column={1}>
              <Descriptions.Item label="卡片类型">{card.card_type}</Descriptions.Item>
              <Descriptions.Item label="币种">{card.currency}</Descriptions.Item>
              <Descriptions.Item label="余额">${card.balance?.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="信用额度">${card.credit_limit?.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="单笔限额">{card.single_limit ? `$${card.single_limit}` : '无限制'}</Descriptions.Item>
              <Descriptions.Item label="日累计限额">{card.daily_limit ? `$${card.daily_limit}` : '无限制'}</Descriptions.Item>
              <Descriptions.Item label="有效期">{card.expire_date}</Descriptions.Item>
              <Descriptions.Item label="用途">{card.purpose || '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
          
          <Card title="操作">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button 
                type="primary" 
                icon={<WalletOutlined />} 
                onClick={() => setTopupModalVisible(true)}
                disabled={card.status !== 1}
                block
              >
                充值
              </Button>
              
              {card.status === 1 ? (
                <Button danger icon={<LockOutlined />} onClick={() => handleFreeze(true)} block>
                  冻结卡片
                </Button>
              ) : card.status === 2 ? (
                <Button icon={<UnlockOutlined />} onClick={() => handleFreeze(false)} block>
                  解冻卡片
                </Button>
              ) : null}
              
              {card.status !== 4 && (
                <Button danger icon={<DeleteOutlined />} onClick={handleCancel} block>
                  注销卡片
                </Button>
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      <Modal
        title="卡片充值"
        open={topupModalVisible}
        onCancel={() => setTopupModalVisible(false)}
        onOk={handleTopup}
        confirmLoading={topupLoading}
      >
        <div style={{ padding: '20px 0' }}>
          <label>充值金额 (USD)</label>
          <InputNumber 
            value={topupAmount} 
            onChange={v => setTopupAmount(v || 0)}
            min={1} 
            max={100000}
            style={{ width: '100%', marginTop: 8 }}
            size="large"
          />
        </div>
      </Modal>
    </div>
  )
}

export default CardDetail