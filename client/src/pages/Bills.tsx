import { useState, useEffect } from 'react'
import { Row, Col, Card, Statistic, Table, Button, Modal, Spin, List, Tag } from 'antd'
import { FileTextOutlined, DownloadOutlined, EyeOutlined } from '@ant-design/icons'
import { getBills, getBillDetail, getBillStatistics } from '../services/api'
import dayjs from 'dayjs'

const Bills: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [bills, setBills] = useState<any[]>([])
  const [statistics, setStatistics] = useState<any>({})
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [selectedBill, setSelectedBill] = useState<any>(null)
  const [billDetail, setBillDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [billsRes, statsRes] = await Promise.all([
        getBills(),
        getBillStatistics()
      ])
      if (billsRes.code === 0) setBills(billsRes.data || [])
      if (statsRes.code === 0) setStatistics(statsRes.data || {})
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewDetail = async (bill: any) => {
    setSelectedBill(bill)
    setDetailModalVisible(true)
    setDetailLoading(true)
    try {
      const res = await getBillDetail(bill.id)
      if (res.code === 0) {
        setBillDetail(res.data)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setDetailLoading(false)
    }
  }

  const typeMap: Record<string, { text: string; color: string }> = {
    PURCHASE: { text: '消费', color: 'red' },
    REFUND: { text: '退款', color: 'green' },
    TOPUP: { text: '充值', color: 'blue' },
    FEE: { text: '手续费', color: 'orange' },
  }

  const columns = [
    {
      title: '账单月份',
      dataIndex: 'month',
      key: 'month',
      render: (month: string) => month,
    },
    {
      title: '消费金额',
      dataIndex: 'total_spend',
      key: 'total_spend',
      render: (val: number) => <span style={{ color: '#ff4d4f' }}>${val?.toFixed(2) || '0.00'}</span>,
    },
    {
      title: '充值金额',
      dataIndex: 'total_topup',
      key: 'total_topup',
      render: (val: number) => <span style={{ color: '#52c41a' }}>${val?.toFixed(2) || '0.00'}</span>,
    },
    {
      title: '手续费',
      dataIndex: 'total_fee',
      key: 'total_fee',
      render: (val: number) => `$${val?.toFixed(2) || '0.00'}`,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Button type="link" size="small" onClick={() => handleViewDetail(record)}>
          <EyeOutlined /> 详情
        </Button>
      ),
    },
  ]

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
  }

  const { currentBill = {}, totalBalance = 0 } = statistics

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>账单中心</h2>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic 
              title="本月消费 (USD)" 
              value={currentBill.total_spend || 0} 
              precision={2}
              valueStyle={{ color: '#ff4d4f' }}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic 
              title="本月充值 (USD)" 
              value={currentBill.total_topup || 0} 
              precision={2}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic 
              title="账户总余额 (USD)" 
              value={totalBalance} 
              precision={2}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="账单列表" extra={<Button icon={<DownloadOutlined />}>下载全部</Button>}>
        <Table 
          columns={columns} 
          dataSource={bills} 
          rowKey="id"
          pagination={false}
        />
      </Card>

      <Modal
        title={`${selectedBill?.month} 月账单详情`}
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={800}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Statistic title="消费" value={billDetail?.bill?.total_spend || 0} precision={2} valueStyle={{ color: '#ff4d4f' }} />
              </Col>
              <Col span={8}>
                <Statistic title="充值" value={billDetail?.bill?.total_topup || 0} precision={2} valueStyle={{ color: '#52c41a' }} />
              </Col>
              <Col span={8}>
                <Statistic title="手续费" value={billDetail?.bill?.total_fee || 0} precision={2} />
              </Col>
            </Row>
            
            <h4>交易明细</h4>
            <List
              size="small"
              dataSource={billDetail?.transactions || []}
              renderItem={(item: any) => (
                <List.Item>
                  <div style={{ flex: 1 }}>
                    <div>{item.merchant_name}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>{dayjs(item.txn_time).format('YYYY-MM-DD HH:mm')}</div>
                  </div>
                  <div>
                    <Tag color={typeMap[item.txn_type]?.color}>{typeMap[item.txn_type]?.text}</Tag>
                    <span style={{ color: item.amount > 0 ? '#52c41a' : '#ff4d4f', marginLeft: 8 }}>
                      {item.amount > 0 ? '+' : ''}{item.amount?.toFixed(2)}
                    </span>
                  </div>
                </List.Item>
              )}
            />
          </>
        )}
      </Modal>
    </div>
  )
}

export default Bills