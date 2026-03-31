import { useState, useEffect } from 'react'
import { Table, Input, Select, DatePicker, Tag, Space, Card, Row, Col, Statistic, Modal, Descriptions, Button, Drawer } from 'antd'
import { SearchOutlined, EyeOutlined, BarChartOutlined } from '@ant-design/icons'
import { getTransactions, getTxnStats } from '../api'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker
const { Option } = Select

const typeMap: Record<string, { text: string; color: string }> = {
  PURCHASE:     { text: '消费',     color: 'red'        },
  REFUND:       { text: '退款',     color: 'green'      },
  TOPUP:        { text: '充值',     color: 'blue'       },
  FEE:          { text: '手续费',   color: 'orange'     },
  MONTHLY_FEE:  { text: '月费',     color: 'orange'     },
  CANCEL_REFUND:{ text: '销卡退款', color: 'cyan'       },
  AUTH:         { text: '预授权',   color: 'purple'     },
  AUTH_RELEASE: { text: '授权释放', color: 'geekblue'   },
}
const statusMap: Record<number, { text: string; color: string }> = {
  0: { text: '处理中', color: 'processing' },
  1: { text: '成功',   color: 'success'    },
  2: { text: '失败',   color: 'error'      },
  3: { text: '已撤销', color: 'default'    },
}

export default function Transactions() {
  const [list, setList]       = useState<any[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [stats, setStats]     = useState<any>({ byType: [], daily: [] })
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20 })
  const [detail, setDetail]   = useState<any>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [statsOpen, setStatsOpen]   = useState(false)

  useEffect(() => { load() }, [filters])
  useEffect(() => { loadStats() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getTransactions(filters)
      if (r.code === 0) { setList(r.data.list); setTotal(r.data.total) }
    } finally { setLoading(false) }
  }

  const loadStats = async () => {
    const r: any = await getTxnStats()
    if (r.code === 0) setStats(r.data)
  }

  // 汇总统计
  const totalVolume = stats.byType.filter((t: any) => t.txn_type === 'PURCHASE').reduce((s: number, t: any) => s + t.volume, 0)
  const totalFee    = stats.byType.reduce((s: number, t: any) => s + t.fee, 0)
  const totalRefund = stats.byType.filter((t: any) => t.txn_type === 'REFUND').reduce((s: number, t: any) => s + t.volume, 0)
  const totalTopup  = stats.byType.filter((t: any) => t.txn_type === 'TOPUP').reduce((s: number, t: any) => s + t.volume, 0)

  const cols = [
    {
      title: '流水号', dataIndex: 'txn_no', key: 'txn_no', width: 200,
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
    },
    { title: '商户编号', dataIndex: 'user_no',       key: 'user_no',       width: 160 },
    { title: '手机号',   dataIndex: 'phone',          key: 'phone',         width: 130 },
    { title: '卡号',     dataIndex: 'card_no_masked', key: 'card_no_masked',width: 120 },
    { title: '卡片名称', dataIndex: 'card_name',      key: 'card_name',     width: 130 },
    {
      title: '类型', dataIndex: 'txn_type', key: 'txn_type', width: 90,
      render: (v: string) => <Tag color={typeMap[v]?.color}>{typeMap[v]?.text || v}</Tag>
    },
    { title: '商户名', dataIndex: 'merchant_name', key: 'merchant_name', width: 140 },
    {
      title: '金额', dataIndex: 'amount', key: 'amount', width: 110,
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {v > 0 ? '+' : ''}{v?.toFixed(2)}
        </span>
      )
    },
    {
      title: '手续费', dataIndex: 'fee', key: 'fee', width: 90,
      render: (v: number) => v ? <span style={{ color: '#faad14' }}>${v?.toFixed(4)}</span> : '-'
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: number) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text}</Tag>
    },
    {
      title: '交易时间', dataIndex: 'txn_time', key: 'txn_time', width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      title: '操作', key: 'action', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <Button type="link" size="small" onClick={() => { setDetail(r); setDetailOpen(true) }}>
          <EyeOutlined /> 详情
        </Button>
      )
    },
  ]

  const statTypeCols = [
    { title: '交易类型', dataIndex: 'txn_type', key: 'txn_type', render: (v: string) => <Tag color={typeMap[v]?.color}>{typeMap[v]?.text || v}</Tag> },
    { title: '笔数',     dataIndex: 'count',    key: 'count'    },
    { title: '金额',     dataIndex: 'volume',   key: 'volume',  render: (v: number) => `$${v?.toFixed(2)}` },
    { title: '手续费',   dataIndex: 'fee',      key: 'fee',     render: (v: number) => `$${v?.toFixed(4)}` },
  ]

  return (
    <div>
      {/* 顶部统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {[
          { title: '累计消费金额', value: `$${totalVolume.toFixed(2)}`,  color: '#ff4d4f' },
          { title: '累计充值金额', value: `$${totalTopup.toFixed(2)}`,   color: '#52c41a' },
          { title: '累计退款金额', value: `$${totalRefund.toFixed(2)}`,  color: '#faad14' },
          { title: '累计手续费',   value: `$${totalFee.toFixed(4)}`,     color: '#722ed1' },
        ].map((s, i) => (
          <Col span={6} key={i}>
            <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: '16px 20px' }}>
              <Statistic title={s.title} value={s.value} valueStyle={{ color: s.color, fontSize: 20 }} />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 筛选栏 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }}>
        <Space wrap>
          <Input
            placeholder="流水号 / 商户编号 / 手机号 / 商户名"
            prefix={<SearchOutlined />}
            style={{ width: 280 }}
            allowClear
            onChange={e => setFilters({ ...filters, keyword: e.target.value, page: 1 })}
          />
          <Select placeholder="交易类型" style={{ width: 120 }} allowClear
            onChange={v => setFilters({ ...filters, txnType: v, page: 1 })}>
            {Object.entries(typeMap).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}
          </Select>
          <Select placeholder="交易状态" style={{ width: 110 }} allowClear
            onChange={v => setFilters({ ...filters, status: v, page: 1 })}>
            {Object.entries(statusMap).map(([k, v]) => <Option key={k} value={Number(k)}>{v.text}</Option>)}
          </Select>
          <RangePicker
            onChange={dates => setFilters({
              ...filters,
              startDate: dates?.[0]?.format('YYYY-MM-DD'),
              endDate:   dates?.[1]?.format('YYYY-MM-DD'),
              page: 1
            })}
          />
          <Button icon={<BarChartOutlined />} onClick={() => setStatsOpen(true)}>
            统计分析
          </Button>
        </Space>
      </Card>

      {/* 交易列表 */}
      <Card style={{ borderRadius: 8 }}>
        <div style={{ marginBottom: 12, color: '#666' }}>
          共 <strong>{total}</strong> 条交易记录
        </div>
        <Table
          columns={cols}
          dataSource={list}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1500 }}
          pagination={{
            total,
            current: filters.page,
            pageSize: filters.pageSize,
            showSizeChanger: true,
            showTotal: t => `共 ${t} 条`,
            onChange: (p, ps) => setFilters({ ...filters, page: p, pageSize: ps })
          }}
        />
      </Card>

      {/* 交易详情抽屉 */}
      <Drawer
        title="交易详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={480}
      >
        {detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="流水号">
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{detail.txn_no}</span>
            </Descriptions.Item>
            <Descriptions.Item label="商户编号">{detail.user_no}</Descriptions.Item>
            <Descriptions.Item label="手机号">{detail.phone}</Descriptions.Item>
            <Descriptions.Item label="卡号">{detail.card_no_masked}</Descriptions.Item>
            <Descriptions.Item label="卡片名称">{detail.card_name}</Descriptions.Item>
            <Descriptions.Item label="交易类型">
              <Tag color={typeMap[detail.txn_type]?.color}>{typeMap[detail.txn_type]?.text || detail.txn_type}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="商户名称">{detail.merchant_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="商户类别码">{detail.merchant_category || '-'}</Descriptions.Item>
            <Descriptions.Item label="交易金额">
              <span style={{ color: detail.amount > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600, fontSize: 16 }}>
                {detail.amount > 0 ? '+' : ''}{detail.amount?.toFixed(2)} {detail.currency}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="手续费">
              {detail.fee ? `$${detail.fee?.toFixed(4)}` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="授权码">{detail.auth_code || '-'}</Descriptions.Item>
            <Descriptions.Item label="参考号">{detail.reference_no || '-'}</Descriptions.Item>
            <Descriptions.Item label="交易状态">
              <Tag color={statusMap[detail.status]?.color}>{statusMap[detail.status]?.text}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="交易时间">
              {dayjs(detail.txn_time).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
            <Descriptions.Item label="结算时间">
              {detail.settled_time ? dayjs(detail.settled_time).format('YYYY-MM-DD HH:mm:ss') : '未结算'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {dayjs(detail.created_at).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>

      {/* 统计分析弹窗 */}
      <Modal
        title="交易统计分析"
        open={statsOpen}
        onCancel={() => setStatsOpen(false)}
        footer={null}
        width={700}
      >
        <div style={{ marginBottom: 16 }}>
          <strong>按交易类型汇总</strong>
        </div>
        <Table
          columns={statTypeCols}
          dataSource={stats.byType}
          rowKey="txn_type"
          pagination={false}
          size="small"
          style={{ marginBottom: 24 }}
        />
        <div style={{ marginBottom: 12 }}>
          <strong>近30天每日交易量</strong>
        </div>
        <Table
          columns={[
            { title: '日期',   dataIndex: 'day',    key: 'day'    },
            { title: '笔数',   dataIndex: 'count',  key: 'count'  },
            { title: '金额',   dataIndex: 'volume', key: 'volume', render: (v: number) => `$${v?.toFixed(2)}` },
          ]}
          dataSource={stats.daily}
          rowKey="day"
          pagination={{ pageSize: 10 }}
          size="small"
        />
      </Modal>
    </div>
  )
}
