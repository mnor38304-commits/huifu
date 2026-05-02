import { useState, useEffect } from 'react'
import { Table, Button, Tag, Modal, Form, Input, Select, InputNumber, message, Popconfirm, Space, Alert, Tooltip, Radio } from 'antd'
import {
  PlusOutlined, EyeOutlined, LockOutlined, UnlockOutlined,
  DeleteOutlined, WalletOutlined, TransactionOutlined, EditOutlined, ClockCircleOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import {
  getCards, getAvailableCardBins, createCard, freezeCard, unfreezeCard,
  cancelCard, topupCard, updateCardRemark, setCardUsageExpiry
} from '../services/api'
import CardDetailModal from '../components/CardDetailModal'

const { Option } = Select

const Cards: React.FC = () => {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<any[]>([])
  const [availableBins, setAvailableBins] = useState<any[]>([])
  const [binsLoading, setBinsLoading] = useState(false)
  const [createModalVisible, setCreateModalVisible] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()

  // Card detail modal state
  const [detailModalCardId, setDetailModalCardId] = useState<number | null>(null)
  const [detailModalVisible, setDetailModalVisible] = useState(false)

  useEffect(() => {
    loadCards()
  }, [])

  const loadCards = async () => {
    try {
      const res = await getCards()
      if (res.code === 0) {
        setCards(res.data || [])
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const loadBins = async () => {
    setBinsLoading(true)
    try {
      const res = await getAvailableCardBins()
      if (res.code === 0) {
        const list = res.data || []
        setAvailableBins(list)
        if (list.length && !form.getFieldValue('binId')) {
          form.setFieldValue('binId', list[0].id)
        }
      } else {
        setAvailableBins([])
      }
    } catch (error) {
      console.error(error)
      setAvailableBins([])
    } finally {
      setBinsLoading(false)
    }
  }

  const openCreateModal = async () => {
    form.resetFields()
    setCreateModalVisible(true)
    await loadBins()
  }

  const handleCreate = async (values: any) => {
    setCreating(true)
    try {
      const res = await createCard(values)
      if (res.code === 0) {
        message.success('开卡成功')
        setCreateModalVisible(false)
        form.resetFields()
        loadCards()
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '开卡失败')
    } finally {
      setCreating(false)
    }
  }

  const handleFreeze = async (id: number, freeze: boolean) => {
    try {
      const res = freeze ? await freezeCard(id) : await unfreezeCard(id)
      if (res.code === 0) {
        message.success(freeze ? '卡片已冻结' : '卡片已解冻')
        loadCards()
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '操作失败')
    }
  }

  const handleCancel = async (id: number) => {
    try {
      const res = await cancelCard(id)
      if (res.code === 0) {
        message.success('卡片已注销')
        loadCards()
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '操作失败')
    }
  }

  // ── 充值弹窗 state ──
  const [topupModalVisible, setTopupModalVisible] = useState(false)
  const [topupCardId, setTopupCardId] = useState<number | null>(null)
  const [topupCardName, setTopupCardName] = useState('')
  const [topupCardBalance, setTopupCardBalance] = useState(0)
  const [topupLoading, setTopupLoading] = useState(false)
  const [topupForm] = Form.useForm()

  const openTopupModal = (record: any) => {
    // UQPay 卡：充值需走渠道真实资金接口，本地接口不可用
    if (record.external_id) {
      message.info('UQPay 卡充值接口待接入渠道真实资金接口，暂不可用')
      return
    }
    setTopupCardId(record.id)
    setTopupCardName(record.card_name || record.card_no_masked)
    setTopupCardBalance(record.balance || 0)
    topupForm.resetFields()
    topupForm.setFieldsValue({ amount: 100 })
    setTopupModalVisible(true)
  }

  const openCardDetail = (record: any) => {
    setDetailModalCardId(record.id)
    setDetailModalVisible(true)
  }

  const closeCardDetail = () => {
    setDetailModalVisible(false)
    setDetailModalCardId(null)
    loadCards()
  }

  // ── 备注编辑弹窗 ──
  const [remarkModalVisible, setRemarkModalVisible] = useState(false)
  const [remarkCardId, setRemarkCardId] = useState<number | null>(null)
  const [remarkCardName, setRemarkCardName] = useState('')
  const [remarkValue, setRemarkValue] = useState('')
  const [remarkSubmitting, setRemarkSubmitting] = useState(false)

  const openRemarkModal = (record: any) => {
    setRemarkCardId(record.id)
    setRemarkCardName(record.card_name || record.card_no_masked)
    setRemarkValue(record.remark || '')
    setRemarkModalVisible(true)
  }

  const handleRemarkSubmit = async () => {
    if (!remarkCardId) return
    setRemarkSubmitting(true)
    try {
      const res = await updateCardRemark(remarkCardId, remarkValue)
      if (res.code === 0) {
        message.success('备注已更新')
        setRemarkModalVisible(false)
        loadCards()
      } else {
        message.error(res.message)
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '更新备注失败')
    } finally {
      setRemarkSubmitting(false)
    }
  }

  // ── 使用到期时间弹窗 ──
  const [expiryModalVisible, setExpiryModalVisible] = useState(false)
  const [expiryCardId, setExpiryCardId] = useState<number | null>(null)
  const [expiryCardName, setExpiryCardName] = useState('')
  const [expiryPreset, setExpiryPreset] = useState('1m')
  const [isUsageExpiredFrozen, setIsUsageExpiredFrozen] = useState(false)
  const [expirySubmitting, setExpirySubmitting] = useState(false)

  const openExpiryModal = (record: any) => {
    setExpiryCardId(record.id)
    setExpiryCardName(record.card_name || record.card_no_masked)
    setExpiryPreset('1m')
    setIsUsageExpiredFrozen(record.status === 2 && record.auto_frozen_reason === 'USAGE_EXPIRED')
    setExpiryModalVisible(true)
  }

  const handleExpirySubmit = async () => {
    if (!expiryCardId) return
    setExpirySubmitting(true)
    try {
      const res = await setCardUsageExpiry(expiryCardId, expiryPreset)
      if (res.code === 0) {
        message.success('使用到期时间已更新')
        setExpiryModalVisible(false)
        loadCards()
      } else {
        message.error(res.message)
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '设置失败')
    } finally {
      setExpirySubmitting(false)
    }
  }

  const handleTopup = async () => {
    if (!topupCardId) return
    const values = await topupForm.validateFields()
    if (!values.amount || values.amount <= 0) {
      message.error('请输入有效金额')
      return
    }
    setTopupLoading(true)
    try {
      const res = await topupCard(topupCardId, values.amount)
      if (res.code === 0) {
        message.success(`充值成功！新余额: $${res.data.newBalance?.toFixed(2)}`)
        setTopupModalVisible(false)
        loadCards()
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '充值失败')
    } finally {
      setTopupLoading(false)
    }
  }

  const handleWithdraw = (record: any) => {
    if (record.external_id) {
      // UQPay 卡：暂不支持
      message.info('UQPay 卡余额转出接口待接入，暂不可用')
    } else {
      message.info('余额转出功能待接入渠道接口后开放')
    }
  }

  const statusMap: Record<number, { text: string; color: string }> = {
    0: { text: '待激活', color: 'default' },
    1: { text: '正常', color: 'green' },
    2: { text: '冻结', color: 'orange' },
    3: { text: '已过期', color: 'red' },
    4: { text: '已注销', color: 'default' },
  }

  const getStatusTag = (status: number, record: any) => {
    if (status === 2 && record.auto_frozen_reason === 'USAGE_EXPIRED') {
      return <Tag color="orange">已到期冻结</Tag>
    }
    const s = statusMap[status]
    return <Tag color={s?.color}>{s?.text}</Tag>
  }

  const getUsageExpiryText = (record: any) => {
    if (!record.usage_expires_at) return <span style={{ color: '#999' }}>未设置</span>
    const now = new Date()
    const expires = new Date(record.usage_expires_at.replace(' ', 'T'))
    if (expires <= now) return <Tag color="red">已到期</Tag>
    const diffDays = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays <= 7) return <Tag color="orange">即将到期</Tag>
    return <span>{record.usage_expires_at}</span>
  }

  const cardTypeMap: Record<string, string> = {
    AD: '广告卡',
    PROC: '采购卡',
    SUB: '订阅卡',
  }

  const columns = [
    {
      title: '卡号',
      dataIndex: 'card_no_masked',
      key: 'card_no_masked',
      render: (text: string, record: any) => (
        <Space>
          <a onClick={() => openCardDetail(record)}>{text}</a>
        </Space>
      )
    },
    {
      title: 'CVV',
      dataIndex: 'cvv',
      key: 'cvv',
      width: 60,
      render: () => <span style={{ fontFamily: "'Courier New', monospace", letterSpacing: 2, color: '#999' }}>***</span>,
    },
    {
      title: '卡面有效期',
      dataIndex: 'expire_date',
      key: 'expire_date',
    },
    {
      title: '余额',
      dataIndex: 'balance',
      key: 'balance',
      render: (val: number) => `$${val?.toFixed(2) || '0.00'}`,
    },
    {
      title: '失败次数',
      dataIndex: 'failed_count',
      key: 'failed_count',
      width: 80,
      render: (v: number) => <span style={{ color: v > 0 ? '#ff4d4f' : '#999' }}>{v || 0}</span>,
    },
    {
      title: '开卡时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => val ? new Date(val).toLocaleString('zh-CN') : '-',
    },
    {
      title: '使用有效期',
      dataIndex: 'usage_expires_at',
      key: 'usage_expires_at',
      render: (_: any, record: any) => getUsageExpiryText(record),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: number, record: any) => getStatusTag(status, record),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      render: (text: string, record: any) => (
        <Space>
          <span style={{ maxWidth: 120, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {text || '-'}
          </span>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openRemarkModal(record)} />
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space size={4} wrap>
          <Button type="link" size="small" onClick={() => openCardDetail(record)}>
            <EyeOutlined /> 详情
          </Button>
          {record.status === 1 && (
            <Button
              type="link"
              size="small"
              icon={<WalletOutlined />}
              style={{ color: '#1677ff' }}
              onClick={() => openTopupModal(record)}
            >
              充值
            </Button>
          )}
          {record.status === 1 && (
            <Tooltip title="余额转出功能待接入渠道接口后开放">
              <Button
                type="link"
                size="small"
                icon={<TransactionOutlined />}
                style={{ color: '#fa8c16' }}
                onClick={() => handleWithdraw(record)}
              >
                余额转出
              </Button>
            </Tooltip>
          )}
          {record.status === 1 && (
            <Button type="link" size="small" danger onClick={() => handleFreeze(record.id, true)}>
              <LockOutlined /> 冻结
            </Button>
          )}
          {record.status === 2 && (
            <Button type="link" size="small" onClick={() => handleFreeze(record.id, false)}>
              <UnlockOutlined /> 解冻
            </Button>
          )}
          {record.status !== 4 && (
            <Popconfirm title="确定要注销此卡片吗？" onConfirm={() => handleCancel(record.id)} okText="确定" cancelText="取消">
              <Button type="link" size="small" danger>
                <DeleteOutlined /> 销卡
              </Button>
            </Popconfirm>
          )}
          {record.status !== 4 && (
            <Button
              type="link"
              size="small"
              icon={<ClockCircleOutlined />}
              style={{ color: '#8c8c8c' }}
              onClick={() => openExpiryModal(record)}
            >
              {record.status === 2 && record.auto_frozen_reason === 'USAGE_EXPIRED' ? '延长使用时间' : '设置到期时间'}
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>VCC 卡片管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          开卡
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={cards}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title="创建新卡片"
        open={createModalVisible}
        onCancel={() => setCreateModalVisible(false)}
        footer={null}
        width={500}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          {createModalVisible && !binsLoading && availableBins.length === 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="当前暂无可用卡 BIN，开卡可能失败，请联系管理员同步并启用可用 BIN。"
            />
          )}

          <Form.Item name="cardName" label="卡片名称" rules={[{ required: true, message: '请输入卡片名称' }]}>
            <Input placeholder="例如：Facebook广告卡" />
          </Form.Item>

          <Form.Item name="binId" label="卡 BIN" rules={availableBins.length ? [{ required: true, message: '请选择卡 BIN' }] : []}>
            <Select loading={binsLoading} placeholder={binsLoading ? '加载 BIN 中...' : '请选择卡 BIN'} allowClear>
              {availableBins.map((bin) => (
                <Option key={bin.id} value={bin.id}>
                  {bin.bin_code} {bin.card_brand ? `(${bin.card_brand})` : ''}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="cardType" label="卡片类型" rules={[{ required: true, message: '请选择卡片类型' }]}>
            <Select placeholder="选择卡片类型">
              <Option value="AD">广告卡 - 用于广告投放</Option>
              <Option value="PROC">采购卡 - 用于供应商付款</Option>
              <Option value="SUB">订阅卡 - 用于SaaS订阅</Option>
            </Select>
          </Form.Item>

          <Form.Item name="creditLimit" label="信用额度 (USD)" rules={[{ required: true, message: '请输入额度' }]}>
            <InputNumber min={10} max={10000} style={{ width: '100%' }} placeholder="10 - 10,000" />
          </Form.Item>

          <Form.Item name="singleLimit" label="单笔限额 (USD)">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="不限制则留空" />
          </Form.Item>

          <Form.Item name="dailyLimit" label="日累计限额 (USD)">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="不限制则留空" />
          </Form.Item>

          <Form.Item name="purpose" label="用途标签">
            <Input placeholder="例如：广告投放、平台入驻" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={creating} block>
              确认开卡
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── 充值弹窗 ── */}
      <Modal
        title={
          <Space>
            <WalletOutlined />
            <span>卡片充值</span>
          </Space>
        }
        open={topupModalVisible}
        onCancel={() => setTopupModalVisible(false)}
        onOk={handleTopup}
        confirmLoading={topupLoading}
        okText="确认充值"
        cancelText="取消"
        width={420}
      >
        <Form form={topupForm} layout="vertical">
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#666', fontSize: 13 }}>充值卡片</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginTop: 4 }}>{topupCardName}</div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#666', fontSize: 13 }}>当前余额</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginTop: 4, color: '#1677ff' }}>
              ${topupCardBalance.toFixed(2)}
            </div>
          </div>
          <Form.Item
            name="amount"
            label="充值金额 (USD)"
            rules={[
              { required: true, message: '请输入充值金额' },
              { type: 'number', min: 0.01, message: '金额必须大于 0' },
            ]}
          >
            <InputNumber
              placeholder="请输入充值金额"
              min={0.01}
              max={100000}
              step={10}
              style={{ width: '100%' }}
              size="large"
              prefix="$"
              autoFocus
            />
          </Form.Item>
        </Form>
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 8 }}
          message="充值将从钱包余额中扣除，请确保钱包余额充足。"
        />
      </Modal>

      {/* ── 卡片详情弹窗 ── */}
      <CardDetailModal
        cardId={detailModalCardId}
        visible={detailModalVisible}
        onClose={closeCardDetail}
      />

      {/* ── 编辑备注弹窗 ── */}
      <Modal
        title="编辑卡片备注"
        open={remarkModalVisible}
        onCancel={() => setRemarkModalVisible(false)}
        onOk={handleRemarkSubmit}
        confirmLoading={remarkSubmitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
          卡片: <strong>{remarkCardName}</strong>
        </div>
        <div style={{ marginBottom: 8, color: '#666', fontSize: 12 }}>
          可备注使用者姓名、用途、平台名称等
        </div>
        <Input
          placeholder="输入卡片备注"
          value={remarkValue}
          onChange={e => setRemarkValue(e.target.value)}
          maxLength={100}
          showCount
        />
      </Modal>

      {/* ── 使用到期时间设置弹窗 ── */}
      <Modal
        title={isUsageExpiredFrozen ? '延长使用时间' : '设置使用到期时间'}
        open={expiryModalVisible}
        onCancel={() => setExpiryModalVisible(false)}
        onOk={handleExpirySubmit}
        confirmLoading={expirySubmitting}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
          卡片: <strong>{expiryCardName}</strong>
        </div>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="设置使用到期时间后，卡片到期会自动冻结。延长使用时间后，因到期被冻结的卡片会自动恢复正常。"
        />
        <div style={{ marginBottom: 8, fontWeight: 500 }}>选择使用期限</div>
        <Radio.Group value={expiryPreset} onChange={e => setExpiryPreset(e.target.value)}>
          <Radio.Button value="1m">1个月</Radio.Button>
          <Radio.Button value="3m">3个月</Radio.Button>
          <Radio.Button value="6m">6个月</Radio.Button>
          <Radio.Button value="1y">1年</Radio.Button>
        </Radio.Group>
      </Modal>
    </div>
  )
}

export default Cards
