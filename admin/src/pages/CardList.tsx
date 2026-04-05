import { useState, useEffect } from 'react'
import { Table, Input, Select, Button, Tag, Space, Card, Modal, message, Drawer, Descriptions, DatePicker } from 'antd'
import { SearchOutlined, LockOutlined, UnlockOutlined, SwapOutlined } from '@ant-design/icons'
import { getCards, setCardStatus, getTransactions } from '../api'
import dayjs from 'dayjs'

const { Option } = Select
const { RangePicker } = DatePicker

const statusMap: Record<number, { text: string; color: string }> = {
  0: { text: '待激活', color: 'default'  },
  1: { text: '正常',   color: 'green'    },
  2: { text: '冻结',   color: 'orange'   },
  3: { text: '已过期', color: 'red'      },
  4: { text: '已注销', color: 'default'  },
}
const typeMap: Record<string, string> = { AD: '广告卡', PROC: '采购卡', SUB: '订阅卡' }
const txnTypeMap: Record<string, { text: string; color: string }> = {
  PURCHASE:     { text: '消费',     color: 'red'     },
  REFUND:       { text: '退款',     color: 'green'   },
  TOPUP:        { text: '充值',     color: 'blue'    },
  FEE:          { text: '手续费',   color: 'orange'  },
  MONTHLY_FEE:  { text: '月费',     color: 'orange'  },
  CANCEL_REFUND:{ text: '销卡退款', color: 'cyan'    },
}
const txnStatusMap: Record<number, { text: string; color: string }> = {
  0: { text: '处理中', color: 'processing' },
  1: { text: '成功',   color: 'success'    },
  2: { text: '失败',   color: 'error'      },
  3: { text: '已撤销', color: 'default'    },
}

export default function CardList() {
  const [list, setList]       = useState<any[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20 })

  // 冻结弹窗
  const [freezeModal, setFreezeModal] = useState<{ visible: boolean; record: any }>({ visible: false, record: null })
  const [reason, setReason] = useState('')

  // 交易抽屉
  const [txnDrawer, setTxnDrawer]     = useState(false)
  const [txnCard, setTxnCard]         = useState<any>(null)
  const [txnList, setTxnList]         = useState<any[]>([])
  const [txnTotal, setTxnTotal]       = useState(0)
  const [txnLoading, setTxnLoading]   = useState(false)
  const [txnFilters, setTxnFilters]   = useState<any>({ page: 1, pageSize: 15 })

  useEffect(() => { load() }, [filters])
  useEffect(() => { if (txnCard) loadTxn() }, [txnFilters, txnCard])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getCards(filters)
      if (r.code === 0) { setList(r.data.list); setTotal(r.data.total) }
    } finally { setLoading(false) }
  }

  const loadTxn = async () => {
    if (!txnCard) return
    setTxnLoading(true)
    try {
      const r: any = await getTransactions({ ...txnFilters, cardId: txnCard.id })
      if (r.code === 0) { setTxnList(r.data.list); setTxnTotal(r.data.total) }
    } finally { setTxnLoading(false) }
  }

  const openTxnDrawer = (card: any) => {
    setTxnCard(card)
    setTxnFilters({ page: 1, pageSize: 15 })
    setTxnDrawer(true)
  }

  const doFreeze = async () => {
    const { record } = freezeModal
    const newStatus = record.status === 1 ? 2 : 1
    const r: any = await setCardStatus(record.id, newStatus, reason)
    if (r.code === 0) {
      message.success('操作成功')
      setFreezeModal({ visible: false, record: null })
      setReason('')
      load()
    }
  }

  const cols = [
    { title: '卡号',     dataIndex: 'card_no_masked', key: 'card_no_masked', width: 130 },
    { title: '卡片名称', dataIndex: 'card_name',      key: 'card_name',      width: 140 },
    {
      title: '类型', dataIndex: 'card_type', key: 'card_type', width: 90,
      render: (v: string) => typeMap[v] || v
    },
    { title: 'BIN',      dataIndex: 'bin_code',    key: 'bin_code',    width: 90  },
    { title: '商户编号', dataIndex: 'user_no',     key: 'user_no',     width: 160 },
    { title: '手机号',   dataIndex: 'phone',       key: 'phone',       width: 130 },
    {
      title: '余额', dataIndex: 'balance', key: 'balance', width: 110,
      render: (v: number) => <span style={{ color: '#52c41a', fontWeight: 600 }}>${(v || 0).toFixed(2)}</span>
    },
    {
      title: '额度', dataIndex: 'credit_limit', key: 'credit_limit', width: 110,
      render: (v: number) => `$${(v || 0).toFixed(2)}`
    },
    { title: '有效期', dataIndex: 'expire_date', key: 'expire_date', width: 110 },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: number) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text}</Tag>
    },
    {
      title: '操作', key: 'action', fixed: 'right' as const, width: 180,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => openTxnDrawer(r)}>
            <SwapOutlined /> 交易
          </Button>
          {r.status === 1 && (
            <Button type="link" size="small" danger onClick={() => setFreezeModal({ visible: true, record: r })}>
              <LockOutlined /> 冻结
            </Button>
          )}
          {r.status === 2 && (
            <Button type="link" size="small" onClick={() => setFreezeModal({ visible: true, record: r })}>
              <UnlockOutlined /> 解冻
            </Button>
          )}
        </Space>
      )
    },
  ]

  const txnCols = [
    {
      title: '时间', dataIndex: 'txn_time', key: 'txn_time', width: 150,
      render: (v: string) => dayjs(v).format('MM-DD HH:mm:ss')
    },
    {
      title: '类型', dataIndex: 'txn_type', key: 'txn_type', width: 90,
      render: (v: string) => <Tag color={txnTypeMap[v]?.color}>{txnTypeMap[v]?.text || v}</Tag>
    },
    { title: '商户', dataIndex: 'merchant_name', key: 'merchant_name', width: 130 },
    {
      title: '金额', dataIndex: 'amount', key: 'amount', width: 100,
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {v > 0 ? '+' : ''}{v?.toFixed(2)}
        </span>
      )
    },
    {
      title: '手续费', dataIndex: 'fee', key: 'fee', width: 80,
      render: (v: number) => v ? <span style={{ color: '#faad14', fontSize: 12 }}>${v?.toFixed(4)}</span> : '-'
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: number) => <Tag color={txnStatusMap[v]?.color}>{txnStatusMap[v]?.text}</Tag>
    },
  ]

  return (
    <div>
      {/* 筛选栏 */}
      <Card style={{ marginBottom: 16, borderRadius: 8 }}>
        <Space wrap>
          <Input
            placeholder="搜索卡号 / 卡名 / 手机号"
            prefix={<SearchOutlined />}
            style={{ width: 240 }}
            allowClear
            onChange={e => setFilters({ ...filters, keyword: e.target.value, page: 1 })}
          />
          <Select placeholder="卡片状态" style={{ width: 120 }} allowClear
            onChange={v => setFilters({ ...filters, status: v, page: 1 })}>
            {Object.entries(statusMap).map(([k, v]) => <Option key={k} value={Number(k)}>{v.text}</Option>)}
          </Select>
          <Select placeholder="卡片类型" style={{ width: 110 }} allowClear
            onChange={v => setFilters({ ...filters, cardType: v, page: 1 })}>
            <Option value="AD">广告卡</Option>
            <Option value="PROC">采购卡</Option>
            <Option value="SUB">订阅卡</Option>
          </Select>
        </Space>
      </Card>

      {/* 卡片列表 */}
      <Card style={{ borderRadius: 8 }}>
        <div style={{ marginBottom: 12, color: '#666' }}>
          共 <strong>{total}</strong> 张卡片
        </div>
        <Table
          columns={cols}
          dataSource={list}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1400 }}
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

      {/* 冻结/解冻弹窗 */}
      <Modal
        title={freezeModal.record?.status === 1 ? '冻结卡片' : '解冻卡片'}
        open={freezeModal.visible}
        onOk={doFreeze}
        onCancel={() => { setFreezeModal({ visible: false, record: null }); setReason('') }}
        okButtonProps={{ danger: freezeModal.record?.status === 1 }}
        okText="确认"
      >
        <p>卡号：<strong>{freezeModal.record?.card_no_masked}</strong>　
           持卡商户：<strong>{freezeModal.record?.user_no}</strong></p>
        <Input.TextArea rows={3} placeholder="操作原因（可选，将记录到操作日志）"
          value={reason} onChange={e => setReason(e.target.value)} />
      </Modal>

      {/* 卡片交易抽屉 */}
      <Drawer
        title={
          <div>
            <span>卡片交易记录</span>
            {txnCard && (
              <span style={{ marginLeft: 12, fontSize: 13, color: '#666' }}>
                {txnCard.card_no_masked} · {txnCard.card_name}
              </span>
            )}
          </div>
        }
        open={txnDrawer}
        onClose={() => { setTxnDrawer(false); setTxnCard(null) }}
        width={760}
      >
        {txnCard && (
          <>
            {/* 卡片基本信息 */}
            <Descriptions size="small" bordered column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="余额">
                <span style={{ color: '#52c41a', fontWeight: 600 }}>${txnCard.balance?.toFixed(2)}</span>
              </Descriptions.Item>
              <Descriptions.Item label="额度">${txnCard.credit_limit?.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={statusMap[txnCard.status]?.color}>{statusMap[txnCard.status]?.text}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="有效期">{txnCard.expire_date}</Descriptions.Item>
              <Descriptions.Item label="商户">{txnCard.user_no}</Descriptions.Item>
              <Descriptions.Item label="手机号">{txnCard.phone}</Descriptions.Item>
            </Descriptions>

            {/* 交易筛选 */}
            <Space wrap style={{ marginBottom: 12 }}>
              <Select placeholder="交易类型" style={{ width: 120 }} allowClear
                onChange={v => setTxnFilters({ ...txnFilters, txnType: v, page: 1 })}>
                {Object.entries(txnTypeMap).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}
              </Select>
              <Select placeholder="状态" style={{ width: 100 }} allowClear
                onChange={v => setTxnFilters({ ...txnFilters, status: v, page: 1 })}>
                {Object.entries(txnStatusMap).map(([k, v]) => <Option key={k} value={Number(k)}>{v.text}</Option>)}
              </Select>
              <RangePicker size="small"
                onChange={dates => setTxnFilters({
                  ...txnFilters,
                  startDate: dates?.[0]?.format('YYYY-MM-DD'),
                  endDate:   dates?.[1]?.format('YYYY-MM-DD'),
                  page: 1
                })}
              />
            </Space>

            {/* 交易列表 */}
            <div style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
              共 <strong>{txnTotal}</strong> 条交易
            </div>
            <Table
              columns={txnCols}
              dataSource={txnList}
              rowKey="id"
              loading={txnLoading}
              size="small"
              scroll={{ x: 620 }}
              pagination={{
                total: txnTotal,
                current: txnFilters.page,
                pageSize: txnFilters.pageSize,
                size: 'small',
                onChange: (p, ps) => setTxnFilters({ ...txnFilters, page: p, pageSize: ps })
              }}
            />
          </>
        )}
      </Drawer>
    </div>
  )
}
