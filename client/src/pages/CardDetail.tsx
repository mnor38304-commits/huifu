import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Row, Col, Button, Modal, InputNumber, message, Descriptions, Tag, Space, Divider, Spin, Alert } from 'antd'
import { WalletOutlined, LockOutlined, UnlockOutlined, DeleteOutlined, EyeOutlined, CopyOutlined, ReloadOutlined, SafetyOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import { getCardDetail, revealCard, getPanToken, topupCard, freezeCard, unfreezeCard, cancelCard } from '../services/api'

const IFRAME_COUNTDOWN_SECONDS = 60

/** Remove channel provider names for user-facing display */
const displayCardName = (name: string): string =>
  name.replace(/\b(UQPay|DogPay|CoinPal)\s+/gi, '')

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

  // Secure iFrame state
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [iframeLoading, setIframeLoading] = useState(false)
  const [countdown, setCountdown] = useState<number>(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearIframe = useCallback(() => {
    setIframeUrl(null)
    setCountdown(0)
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    loadCardDetail()
    return () => clearIframe()
  }, [id])

  const startCountdown = useCallback((seconds: number) => {
    setCountdown(seconds)
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
    }
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current)
            countdownRef.current = null
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  const handleReveal = async () => {
    if (cardRevealed) {
      setCardRevealed(false)
      clearIframe()
      return
    }
    setRevealLoading(true)
    try {
      const res = await revealCard(Number(id))
      if (res.code === 0) {
        const revealData = res.data

        if (revealData.mode === 'secure_iframe') {
          // UQPay Secure iFlow mode: fetch pan-token then render iframe
          setCardRevealed(true)
          setCard({ ...card, ...revealData })
          setIframeLoading(true)
          try {
            const tokenRes = await getPanToken(Number(id))
            if (tokenRes.code === 0) {
              setIframeUrl(tokenRes.data.iframeUrl)
              startCountdown(tokenRes.data.expiresIn)
            } else {
              message.error(tokenRes.message || '获取 Secure iFrame 失败')
              setCardRevealed(false)
            }
          } catch (err: any) {
            message.error(err.response?.data?.message || '获取 Secure iFrame 失败')
            setCardRevealed(false)
          } finally {
            setIframeLoading(false)
          }
        } else {
          // Mock / DogPay legacy mode
          setCard({ ...card, ...revealData })
          setCardRevealed(true)
        }
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '获取失败')
    } finally {
      setRevealLoading(false)
    }
  }

  const handleRefreshIframe = async () => {
    clearIframe()
    setIframeLoading(true)
    try {
      const tokenRes = await getPanToken(Number(id))
      if (tokenRes.code === 0) {
        setIframeUrl(tokenRes.data.iframeUrl)
        startCountdown(tokenRes.data.expiresIn)
      } else {
        message.error(tokenRes.message || '重新获取失败')
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || '重新获取失败')
    } finally {
      setIframeLoading(false)
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

  const isSecureIframeMode = card?.mode === 'secure_iframe'
  const isTokenExpired = countdown === 0 && cardRevealed && isSecureIframeMode

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
          {/* ---- Card visual (no channel branding, high contrast) ---- */}
          <Card 
            title={displayCardName(card.card_name || '')}
            extra={<Tag color={statusMap[card.status]?.color}>{statusMap[card.status]?.text}</Tag>}
            style={{ 
              background: card.status === 1 
                ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f3460 100%)'
                : '#f0f2f5',
              color: card.status === 1 ? '#f8fafc' : '#334155',
              border: card.status === 1 ? 'none' : '1px solid #e2e8f0',
              borderRadius: 16,
              minHeight: 260,
            }}
            headStyle={{ 
              color: card.status === 1 ? '#f1f5f9' : '#334155',
              borderBottom: card.status === 1 ? '1px solid rgba(255,255,255,0.08)' : '1px solid #e2e8f0',
              fontSize: 18,
              fontWeight: 600,
            }}
            bodyStyle={{ padding: '24px 24px 20px' }}
          >
            <div style={{
              fontSize: 26, fontWeight: 700, marginBottom: 28, letterSpacing: 3,
              fontFamily: '"Courier New", Consolas, monospace',
              color: card.status === 1 ? '#ffffff' : '#334155',
              textShadow: card.status === 1 ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
            }}>
              {card.card_no_masked}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: card.status === 1 ? 'rgba(255,255,255,0.55)' : '#64748b', marginBottom: 4 }}>有效期</div>
                <div style={{ fontSize: 18, fontWeight: 500 }}>{cardRevealed && !isSecureIframeMode ? card.expireDate : '**/**'}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: card.status === 1 ? 'rgba(255,255,255,0.55)' : '#64748b', marginBottom: 4 }}>CVV</div>
                <div style={{ fontSize: 18, fontWeight: 500 }}>{cardRevealed && !isSecureIframeMode ? card.cvv : '***'}</div>
              </div>
            </div>
            
            {/* Legacy mode: show card number directly */}
            {cardRevealed && !isSecureIframeMode && (
              <div style={{ 
                background: card.status === 1 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
                padding: 12, borderRadius: 10, marginBottom: 16 
              }}>
                <div style={{ fontSize: 12, color: card.status === 1 ? 'rgba(255,255,255,0.55)' : '#64748b', marginBottom: 4 }}>完整卡号</div>
                <div style={{ fontSize: 20, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                  {card.cardNo}
                  <CopyOutlined style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => copyToClipboard(card.cardNo)} />
                </div>
              </div>
            )}

            {/* Secure iFrame mode: render iframe inside card body (no hint here) */}
            {cardRevealed && isSecureIframeMode && (
              <div style={{ marginBottom: 16 }}>
                {iframeLoading && (
                  <div style={{ textAlign: 'center', padding: '80px 0' }}>
                    <Spin size="large" />
                    <div style={{ marginTop: 12, opacity: 0.85 }}>正在获取安全卡面...</div>
                  </div>
                )}

                {iframeUrl && countdown > 0 && (
                  <iframe
                    src={iframeUrl}
                    style={{
                      width: '100%',
                      height: 360,
                      border: card.status === 1 ? '1px solid rgba(255,255,255,0.12)' : '1px solid #e2e8f0',
                      borderRadius: 10,
                      background: '#fff',
                    }}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    title="Secure Card View"
                  />
                )}

                {isTokenExpired && (
                  <div style={{ textAlign: 'center', padding: '60px 0' }}>
                    <LockOutlined style={{ fontSize: 32, marginBottom: 12, opacity: 0.6 }} />
                    <div style={{ marginBottom: 16, opacity: 0.85 }}>卡面信息已过期</div>
                    <Button
                      type="primary"
                      icon={<ReloadOutlined />}
                      onClick={handleRefreshIframe}
                      loading={iframeLoading}
                    >
                      重新获取卡面
                    </Button>
                  </div>
                )}
              </div>
            )}
            
            <Button 
              type="primary" 
              ghost={card.status === 1}
              loading={revealLoading}
              onClick={handleReveal}
              block
            >
              {cardRevealed ? '隐藏卡片信息' : isSecureIframeMode
                ? <><SafetyOutlined /> 安全查看卡面</>
                : <><EyeOutlined /> 查看完整卡号</>
              }
            </Button>
          </Card>

          {/* ---- Security hint: placed OUTSIDE the card body ---- */}
          {cardRevealed && isSecureIframeMode && (
            <div style={{ marginTop: 12 }}>
              <Alert
                message={
                  <Space>
                    <SafetyOutlined />
                    <span>
                      为保护卡片安全，完整卡信息通过安全卡面查看，{countdown > 0 ? `${countdown} 秒后自动失效` : '已失效'}。请勿截图或转发卡面内容。
                    </span>
                  </Space>
                }
                type={countdown > 0 ? 'info' : 'warning'}
                showIcon={false}
                style={{ borderRadius: 10 }}
              />
            </div>
          )}

          {/* ---- Expired hint outside card (when iframe is not visible) ---- */}
          {!iframeUrl && isTokenExpired && (
            <div style={{ marginTop: 12 }}>
              <Alert
                message="为保护卡片安全，卡面信息已过期，请点击上方按钮重新获取。"
                type="warning"
                showIcon={false}
                style={{ borderRadius: 10 }}
              />
            </div>
          )}
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
