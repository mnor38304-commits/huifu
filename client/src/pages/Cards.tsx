import { useState, useEffect } from 'react'
import { Table, Button, Tag, Modal, Form, Input, Select, InputNumber, message, Popconfirm, Space, Alert } from 'antd'
import { PlusOutlined, EyeOutlined, LockOutlined, UnlockOutlined, DeleteOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getCards, getAvailableCardBins, createCard, freezeCard, unfreezeCard, cancelCard } from '../services/api'

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

  const statusMap: Record<number, { text: string; color: string }> = {
    0: { text: '待激活', color: 'default' },
    1: { text: '正常', color: 'green' },
    2: { text: '冻结', color: 'orange' },
    3: { text: '已过期', color: 'red' },
    4: { text: '已注销', color: 'default' },
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
          <a onClick={() => navigate(`/cards/${record.id}`)}>{text}</a>
        </Space>
      )
    },
    {
      title: '卡片名称',
      dataIndex: 'card_name',
      key: 'card_name',
    },
    {
      title: '类型',
      dataIndex: 'card_type',
      key: 'card_type',
      render: (type: string) => cardTypeMap[type] || type,
    },
    {
      title: '余额',
      dataIndex: 'balance',
      key: 'balance',
      render: (val: number) => `$${val?.toFixed(2) || '0.00'}`,
    },
    {
      title: '额度',
      dataIndex: 'credit_limit',
      key: 'credit_limit',
      render: (val: number) => `$${val?.toFixed(2) || '0.00'}`,
    },
    {
      title: '有效期',
      dataIndex: 'expire_date',
      key: 'expire_date',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: number) => <Tag color={statusMap[status]?.color}>{statusMap[status]?.text}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => navigate(`/cards/${record.id}`)}>
            <EyeOutlined /> 详情
          </Button>
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
    </div>
  )
}

export default Cards
