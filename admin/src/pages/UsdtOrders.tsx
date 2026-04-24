import { useState, useEffect } from 'react'
import { Table, Button, Tag, Space, Card, Modal, Input, message, Row, Col, Statistic, Select } from 'antd'
import { CheckCircleOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons'
import { getUsdtOrders, confirmUsdt, getUsdtStats, syncUsdtOrder } from '../api'

const { Option } = Select

const statusMap: Record<number, { text: string; color: string }> = {
  0: { text: '待支付', color: 'default' }, 1: { text: '已支付', color: 'processing' },
  2: { text: '已确认', color: 'success' }, 3: { text: '已过期', color: 'error' }, 4: { text: '失败', color: 'error' }
}
const networkColors: Record<string, string> = { TRC20: 'green', ERC20: 'blue', BEP20: 'orange' }

export default function UsdtOrders() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<number | null>(null)
  const [stats, setStats] = useState<any>({})
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20 })
  const [confirmModal, setConfirmModal] = useState<{ visible: boolean; record: any }>({ visible: false, record: null })
  const [txHash, setTxHash] = useState('')

  useEffect(() => { load(); loadStats() }, [filters])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getUsdtOrders(filters)
      if (r.code === 0) { setList(r.data.list); setTotal(r.data.total) }
    } finally { setLoading(false) }
  }

  const loadStats = async () => {
    const r: any = await getUsdtStats()
    if (r.code === 0) setStats(r.data)
  }

  const doConfirm = async () => {
    const r: any = await confirmUsdt(confirmModal.record.id, txHash)
    if (r.code === 0) { message.success('已确认到账'); setConfirmModal({ visible: false, record: null }); setTxHash(''); load(); loadStats() }
    else message.error(r.message)
  }

  const handleSyncOrder = async (order: any) => {
    if (!order.dogpay_order_id) { message.warning('该订单未对接DogPay'); return }
    setSyncing(order.id)
    try {
      const r: any = await syncUsdtOrder(order.id)
      if (r.code === 0) { message.success('状态同步成功'); load(); loadStats() }
      else message.error(r.message || '同步失败')
    } catch (e: any) {
      message.error(e.response?.data?.message || '同步失败')
    } finally { setSyncing(null) }
  }

  const cols = [
    { title: '订单号', dataIndex: 'order_no', key: 'order_no', width: 180 },
    { title: '商户', dataIndex: 'user_no', key: 'user_no', width: 160 },
    { title: '手机号', dataIndex: 'phone', key: 'phone', width: 130 },
    { title: 'USDT金额', dataIndex: 'amount_usdt', key: 'amount_usdt', width: 120,
      render: (v: number) => <span style={{ fontWeight: 600, color: '#52c41a' }}>{v} USDT</span> },
    { title: 'USD金额', dataIndex: 'amount_usd', key: 'amount_usd', width: 110,
      render: (v: number) => `$${v?.toFixed(2)}` },
    { title: '网络', dataIndex: 'network', key: 'network', width: 90,
      render: (v: string) => <Tag color={networkColors[v]}>{v}</Tag> },
    { title: '收款地址', dataIndex: 'pay_address', key: 'pay_address', width: 200,
      render: (v: string) => <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{v?.slice(0,12)}...{v?.slice(-6)}</span> },
    { title: '链上Hash', dataIndex: 'tx_hash', key: 'tx_hash', width: 160,
      render: (v: string) => v ? <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{v?.slice(0,10)}...</span> : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: number) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v?.replace('T',' ').split('.')[0] },
    { title: '操作', key: 'action', fixed: 'right' as const, width: 180,
      render: (_: any, r: any) => (
        <Space size="small">
          {r.dogpay_order_id && r.status !== 2 && (
            <Button type="text" size="small" icon={<SyncOutlined spin={syncing === r.id} />} onClick={() => handleSyncOrder(r)} loading={syncing === r.id}>
              同步
            </Button>
          )}
          {(r.status === 0 || r.status === 1) ? (
            <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={() => setConfirmModal({ visible: true, record: r })}>
              确认
            </Button>
          ) : null}
        </Space>
      )
    }
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {[
          { title: '总订单数', value: stats.totalOrders, color: '#1890ff' },
          { title: '已确认金额', value: `${(stats.confirmedAmt||0).toFixed(2)} USDT`, color: '#52c41a' },
          { title: '今日到账', value: `${(stats.todayAmt||0).toFixed(2)} USDT`, color: '#faad14' },
          { title: '待确认订单', value: stats.pendingOrders, color: '#ff4d4f' },
        ].map((s, i) => (
          <Col span={6} key={i}>
            <Card style={{ borderRadius: 8 }}>
              <Statistic title={s.title} value={s.value} valueStyle={{ color: s.color, fontSize: 22 }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ marginBottom: 16, borderRadius: 8 }}>
        <Space wrap>
          <Input placeholder="搜索用户/Hash" prefix={<SearchOutlined />} style={{ width: 220 }}
            onChange={e => setFilters({ ...filters, keyword: e.target.value, page: 1 })} />
          <Select placeholder="订单状态" style={{ width: 120 }} allowClear onChange={v => setFilters({ ...filters, status: v, page: 1 })}>
            {Object.entries(statusMap).map(([k, v]) => <Option key={k} value={Number(k)}>{v.text}</Option>)}
          </Select>
        </Space>
      </Card>

      <Card style={{ borderRadius: 8 }}>
        <Table columns={cols} dataSource={list} rowKey="id" loading={loading} scroll={{ x: 1400 }}
          pagination={{ total, current: filters.page, pageSize: filters.pageSize, showSizeChanger: true,
            onChange: (p, ps) => setFilters({ ...filters, page: p, pageSize: ps }) }} />
      </Card>

      <Modal title="确认 USDT 到账" open={confirmModal.visible} onOk={doConfirm}
        onCancel={() => setConfirmModal({ visible: false, record: null })} okText="确认到账">
        <div style={{ marginBottom: 16 }}>
          <p>订单号: <strong>{confirmModal.record?.order_no}</strong></p>
          <p>金额: <strong style={{ color: '#52c41a' }}>{confirmModal.record?.amount_usdt} USDT</strong> = ${confirmModal.record?.amount_usd?.toFixed(2)}</p>
          <p>网络: <Tag color={networkColors[confirmModal.record?.network]}>{confirmModal.record?.network}</Tag></p>
        </div>
        <Input placeholder="链上交易 Hash（可选）" value={txHash} onChange={e => setTxHash(e.target.value)}
          style={{ fontFamily: 'monospace' }} />
      </Modal>
    </div>
  )
}
