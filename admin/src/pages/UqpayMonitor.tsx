import { useState, useEffect } from 'react'
import { Table, Tabs, Card, Tag, Input, Select, DatePicker, Space, Row, Col, Statistic } from 'antd'
import { WarningOutlined, ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { getUqpayRechargeOrders, getUqpayReconcileAlerts, getUqpayWebhookEvents } from '../api'

const { RangePicker } = DatePicker
const { Option } = Select

// ── 状态映射 ─────────────────────────────────────────────────
const statusColors: Record<string, string> = {
  PENDING: 'orange', SUCCESS: 'green', FAILED: 'red',
  REFUNDED: 'purple', CANCELLED: 'default', UNKNOWN: 'geekblue'
}
const severityColors: Record<string, string> = {
  WARNING: 'orange', CRITICAL: 'red', INFO: 'blue'
}
const processedColors: Record<string, string> = {
  PENDING: 'orange', PROCESSING: 'blue', SUCCESS: 'green', FAILED: 'red'
}

// ── 时间格式化 ─────────────────────────────────────────────────
function fmtDT(v: string | null | undefined): string {
  return v ? v.replace('T', ' ').split('.')[0] : '-'
}

// ── PENDING 订单超时判断 ─────────────────────────────────────
function getPendingTag(createdAt: string) {
  if (!createdAt) return null
  const created = new Date(createdAt).getTime()
  const now = Date.now()
  const minutes = (now - created) / 60000
  if (minutes > 30) return <Tag color="red" icon={<CloseCircleOutlined />}>超30分钟</Tag>
  if (minutes > 10) return <Tag color="orange" icon={<WarningOutlined />}>超10分钟</Tag>
  return <Tag color="blue" icon={<ClockCircleOutlined />}>{Math.floor(minutes)}分钟</Tag>
}

export default function UqpayMonitor() {
  const [activeTab, setActiveTab] = useState('orders')

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>UQPay 监控</h2>
      <Tabs activeKey={activeTab} onChange={setActiveTab} type="card" style={{ marginBottom: 0 }}>
        <Tabs.TabPane tab="充值订单" key="orders">
          <OrdersTab />
        </Tabs.TabPane>
        <Tabs.TabPane tab="PENDING/UNKNOWN 异常订单" key="pending">
          <PendingTab />
        </Tabs.TabPane>
        <Tabs.TabPane tab="对账告警" key="alerts">
          <AlertsTab />
        </Tabs.TabPane>
      </Tabs>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// A. 充值订单表
// ═══════════════════════════════════════════════════════════════
function OrdersTab() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20 })

  useEffect(() => { load() }, [filters])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getUqpayRechargeOrders(filters)
      if (r.code === 0) { setList(r.data.list); setTotal(r.data.total) }
    } finally { setLoading(false) }
  }

  const onSearch = (key: string, val: any) => {
    setFilters((prev: any) => ({ ...prev, [key]: val, page: 1 }))
  }

  const cols = [
    { title: '订单ID', dataIndex: 'id', key: 'id', width: 70 },
    { title: '用户ID', dataIndex: 'user_id', key: 'user_id', width: 70 },
    { title: '卡ID', dataIndex: 'card_id', key: 'card_id', width: 60 },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 80,
      render: (v: number) => `$${v?.toFixed(2)}` },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => <Tag color={statusColors[v]}>{v}</Tag> },
    { title: 'card_order_id', dataIndex: 'card_order_id', key: 'card_order_id', width: 160,
      render: (v: string) => <code style={{ fontSize: 11 }}>{v || '-'}</code> },
    { title: 'request_id', dataIndex: 'unique_request_id', key: 'unique_request_id', width: 160,
      render: (v: string) => <code style={{ fontSize: 11 }}>{v || '-'}</code> },
    { title: '错误信息', dataIndex: 'error_message', key: 'error_message', width: 200,
      render: (v: string) => v ? <span style={{ color: '#cf1322' }}>{v}</span> : '-' },
    { title: '管理员ID', dataIndex: 'admin_user_id', key: 'admin_user_id', width: 80,
      render: (v: number | null) => v ?? '-' },
    { title: '审计备注', dataIndex: 'audit_remark', key: 'audit_remark', width: 120,
      render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => fmtDT(v) },
    { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 160,
      render: (v: string) => fmtDT(v) },
  ]

  return (
    <Card style={{ borderRadius: 8 }}>
      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select placeholder="状态" style={{ width: 120 }} allowClear
            onChange={v => onSearch('status', v)}>
            <Option value="PENDING">PENDING</Option>
            <Option value="SUCCESS">SUCCESS</Option>
            <Option value="FAILED">FAILED</Option>
            <Option value="REFUNDED">REFUNDED</Option>
            <Option value="CANCELLED">CANCELLED</Option>
            <Option value="UNKNOWN">UNKNOWN</Option>
          </Select>
          <Input placeholder="用户ID" style={{ width: 120 }}
            onChange={e => onSearch('user_id', e.target.value)} />
          <Input placeholder="卡ID" style={{ width: 100 }}
            onChange={e => onSearch('card_id', e.target.value)} />
          <Input placeholder="订单ID" style={{ width: 100 }}
            onChange={e => onSearch('order_id', e.target.value)} />
          <Input placeholder="搜索关键词" style={{ width: 200 }}
            onChange={e => onSearch('keyword', e.target.value)} />
          <RangePicker
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                onSearch('date_from', dates[0].format('YYYY-MM-DD'))
                onSearch('date_to', dates[1].format('YYYY-MM-DD'))
              } else {
                onSearch('date_from', '')
                onSearch('date_to', '')
              }
            }}
          />
        </Space>
      </div>
      <Table
        columns={cols}
        dataSource={list}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1600 }}
        pagination={{
          total, current: filters.page, pageSize: filters.pageSize, showSizeChanger: true,
          onChange: (p, ps) => setFilters({ ...filters, page: p, pageSize: ps })
        }}
      />
    </Card>
  )
}

// ═══════════════════════════════════════════════════════════════
// B. PENDING/UNKNOWN 异常订单表
// ═══════════════════════════════════════════════════════════════
function PendingTab() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 20

  useEffect(() => { load() }, [page])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getUqpayRechargeOrders({ page, pageSize, status: 'PENDING' })
      const r2: any = await getUqpayRechargeOrders({ page: 1, pageSize: 9999, status: 'UNKNOWN' })
      if (r.code === 0) {
        // 合并 PENDING + UNKNOWN
        const unknownList = r2.code === 0 ? (r2.data.list || []) : []
        const merged = [...(r.data.list || []), ...unknownList]
        // 按创建时间排序（最新的在前）
        merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        setList(merged)
        setTotal(merged.length)
      }
    } finally { setLoading(false) }
  }

  const cols = [
    { title: '订单ID', dataIndex: 'id', key: 'id', width: 70 },
    { title: '用户ID', dataIndex: 'user_id', key: 'user_id', width: 70 },
    { title: '卡ID', dataIndex: 'card_id', key: 'card_id', width: 60 },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 80,
      render: (v: number) => `$${v?.toFixed(2)}` },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => <Tag color={statusColors[v]}>{v}</Tag> },
    { title: '超时状态', key: 'timeout', width: 130,
      render: (_: any, r: any) => getPendingTag(r.created_at) },
    { title: '错误信息', dataIndex: 'error_message', key: 'error_message', width: 250,
      render: (v: string) => v ? <span style={{ color: '#cf1322' }}>{v}</span> : '-' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => fmtDT(v) },
    { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 160,
      render: (v: string) => fmtDT(v) },
    { title: '备注', dataIndex: 'audit_remark', key: 'audit_remark', width: 120,
      render: (v: string) => v || '-' },
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title="PENDING 订单数"
              value={list.filter(r => r.status === 'PENDING').length}
              valueStyle={{ color: '#faad14' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title="UNKNOWN 订单数"
              value={list.filter(r => r.status === 'UNKNOWN').length}
              valueStyle={{ color: '#722ed1' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title="超10分钟"
              value={list.filter(r => {
                if (!r.created_at) return false
                return (Date.now() - new Date(r.created_at).getTime()) / 60000 > 10
              }).length}
              valueStyle={{ color: '#cf1322' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
      </Row>
      <Card style={{ borderRadius: 8 }}>
        <div style={{ marginBottom: 12, fontSize: 16, fontWeight: 600 }}>
          异常订单监控 <Tag color="orange">只读</Tag>
        </div>
        <Table
          columns={cols}
          dataSource={list}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1300 }}
          pagination={{ total, current: page, pageSize, onChange: setPage }}
          rowClassName={(r: any) => {
            if (!r.created_at) return ''
            const mins = (Date.now() - new Date(r.created_at).getTime()) / 60000
            if (mins > 30) return 'row-critical'
            if (mins > 10) return 'row-warning'
            return ''
          }}
        />
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// C. 告警表
// ═══════════════════════════════════════════════════════════════
function AlertsTab() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20 })

  useEffect(() => { load() }, [filters])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getUqpayReconcileAlerts(filters)
      if (r.code === 0) { setList(r.data.list); setTotal(r.data.total) }
    } finally { setLoading(false) }
  }

  const onSearch = (key: string, val: any) => {
    setFilters((prev: any) => ({ ...prev, [key]: val, page: 1 }))
  }

  const cols = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '告警类型', dataIndex: 'alert_type', key: 'alert_type', width: 120,
      render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '严重级别', dataIndex: 'severity', key: 'severity', width: 100,
      render: (v: string) => <Tag color={severityColors[v]}>{v}</Tag> },
    { title: '订单ID', dataIndex: 'order_id', key: 'order_id', width: 70,
      render: (v: number | null) => v ?? '-' },
    { title: '用户ID', dataIndex: 'user_id', key: 'user_id', width: 70,
      render: (v: number | null) => v ?? '-' },
    { title: '卡ID', dataIndex: 'card_id', key: 'card_id', width: 60,
      render: (v: number | null) => v ?? '-' },
    { title: '消息', dataIndex: 'message', key: 'message', width: 300 },
    { title: '首次发现', dataIndex: 'first_seen_at', key: 'first_seen_at', width: 160,
      render: (v: string) => fmtDT(v) },
    { title: '最近发现', dataIndex: 'last_seen_at', key: 'last_seen_at', width: 160,
      render: (v: string) => fmtDT(v) },
    { title: '解决时间', dataIndex: 'resolved_at', key: 'resolved_at', width: 160,
      render: (v: string | null) => v ? fmtDT(v) : <Tag color="orange">未解决</Tag> },
  ]

  return (
    <Card style={{ borderRadius: 8 }}>
      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select placeholder="严重级别" style={{ width: 130 }} allowClear
            onChange={v => onSearch('severity', v)}>
            <Option value="CRITICAL">CRITICAL</Option>
            <Option value="WARNING">WARNING</Option>
            <Option value="INFO">INFO</Option>
          </Select>
          <Input placeholder="订单ID" style={{ width: 100 }}
            onChange={e => onSearch('order_id', e.target.value)} />
          <RangePicker
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                onSearch('date_from', dates[0].format('YYYY-MM-DD'))
                onSearch('date_to', dates[1].format('YYYY-MM-DD'))
              } else {
                onSearch('date_from', '')
                onSearch('date_to', '')
              }
            }}
          />
        </Space>
      </div>
      <Table
        columns={cols}
        dataSource={list}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1400 }}
        pagination={{
          total, current: filters.page, pageSize: filters.pageSize, showSizeChanger: true,
          onChange: (p, ps) => setFilters({ ...filters, page: p, pageSize: ps })
        }}
      />
    </Card>
  )
}
