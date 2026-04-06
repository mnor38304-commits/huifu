import { useState, useEffect } from 'react'
import { Table, Card, Button, Input, Modal, Form, InputNumber, Select, message, Tag, Space, Typography, Row, Col, Statistic } from 'antd'
import { SearchOutlined, PlusOutlined, MinusOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import { getWalletList, getWalletDetail, adjustWalletBalance, getWalletRecords } from '../api'

const { Text } = Typography

export default function WalletManagement() {
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [keyword, setKeyword] = useState('')
  
  // 调整弹窗
  const [adjustVisible, setAdjustVisible] = useState(false)
  const [adjustForm] = Form.useForm()
  const [adjustLoading, setAdjustLoading] = useState(false)
  const [selectedWallet, setSelectedWallet] = useState<any>(null)
  
  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false)
  const [detailData, setDetailData] = useState<any>(null)
  const [records, setRecords] = useState<any[]>([])

  const loadData = async (page = 1, pageSize = 20) => {
    setLoading(true)
    try {
      const res: any = await getWalletList({ page, pageSize, keyword })
      if (res.code === 0) {
        setList(res.data.list)
        setPagination({ current: page, pageSize, total: res.data.total })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleSearch = () => {
    setPagination({ ...pagination, current: 1 })
    loadData(1, pagination.pageSize)
  }

  const handleTableChange = (pag: any) => {
    loadData(pag.current, pag.pageSize)
  }

  const openAdjust = (wallet: any) => {
    setSelectedWallet(wallet)
    adjustForm.setFieldsValue({ type: 'increase', amount: undefined, reason: '' })
    setAdjustVisible(true)
  }

  const handleAdjust = async () => {
    try {
      await adjustForm.validateFields()
      setAdjustLoading(true)
      const values = adjustForm.getFieldsValue()
      const res: any = await adjustWalletBalance(selectedWallet.user_id, values.amount, values.type, values.reason)
      if (res.code === 0) {
        message.success('调整成功')
        setAdjustVisible(false)
        loadData(pagination.current, pagination.pageSize)
      } else {
        message.error(res.message || '调整失败')
      }
    } catch (e: any) {
      if (e.errorFields) return
      message.error(e.message || '操作失败')
    } finally {
      setAdjustLoading(false)
    }
  }

  const openDetail = async (wallet: any) => {
    setDetailVisible(true)
    setDetailData(wallet)
    const res: any = await getWalletRecords(wallet.user_id)
    if (res.code === 0) {
      setRecords(res.data.list || [])
    }
  }

  const columns = [
    { title: '商户编号', dataIndex: 'user_no', key: 'user_no', width: 120 },
    { title: '手机号', dataIndex: 'phone', key: 'phone', width: 120 },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 180 },
    { title: 'USD余额', dataIndex: 'balance_usd', key: 'balance_usd', width: 120,
      render: (v: number) => <Text strong style={{ color: '#52c41a' }}>${(v || 0).toFixed(2)}</Text> },
    { title: 'USDT余额', dataIndex: 'balance_usdt', key: 'balance_usdt', width: 120,
      render: (v: number) => <Text strong>₮{(v || 0).toFixed(2)}</Text> },
    { title: '锁定金额', dataIndex: 'locked_usd', key: 'locked_usd', width: 100,
      render: (v: number) => <Text type="secondary">${(v || 0).toFixed(2)}</Text> },
    { title: '状态', dataIndex: 'user_status', key: 'user_status', width: 80,
      render: (v: number) => v === 1 ? <Tag color="green">正常</Tag> : <Tag color="red">禁用</Tag> },
    { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 160 },
    { title: '操作', key: 'action', width: 180,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => openAdjust({ ...r, type: 'increase' })}>调增</Button>
          <Button size="small" type="link" danger icon={<MinusOutlined />} onClick={() => openAdjust({ ...r, type: 'decrease' })}>调减</Button>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openDetail(r)}>详情</Button>
        </Space>
      )
    },
  ]

  const recordColumns = [
    { title: '调整类型', dataIndex: 'type', key: 'type', width: 100,
      render: (v: string) => v === 'increase' ? <Tag color="green">调增</Tag> : <Tag color="red">调减</Tag> },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 100,
      render: (v: number) => <Text strong>${v?.toFixed(2)}</Text> },
    { title: '调前余额', dataIndex: 'balance_before', key: 'balance_before', width: 100 },
    { title: '调后余额', dataIndex: 'balance_after', key: 'balance_after', width: 100 },
    { title: '管理员', dataIndex: 'admin_name', key: 'admin_name', width: 100 },
    { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 160 },
  ]

  return (
    <div>
      <Card title="商户钱包管理" extra={
        <Space>
          <Input placeholder="搜索商户" value={keyword} onChange={e => setKeyword(e.target.value)} style={{ width: 200 }} prefix={<SearchOutlined />} onPressEnter={handleSearch} />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
          <Button icon={<ReloadOutlined />} onClick={() => loadData()}>刷新</Button>
        </Space>
      }>
        <Table 
          columns={columns} 
          dataSource={list} 
          rowKey="id" 
          loading={loading}
          pagination={pagination}
          onChange={handleTableChange}
          size="small"
        />
      </Card>

      {/* 余额调整弹窗 */}
      <Modal
        title={adjustForm.getFieldValue('type') === 'increase' ? '调增余额' : '调减余额'}
        open={adjustVisible}
        onOk={handleAdjust}
        onCancel={() => setAdjustVisible(false)}
        confirmLoading={adjustLoading}
        okText="确认"
        cancelText="取消"
      >
        <Form form={adjustForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Statistic title="商户编号" value={selectedWallet?.user_no || '-'} />
            </Col>
            <Col span={12}>
              <Statistic title="当前余额" value={selectedWallet?.balance_usd || 0} prefix="$" />
            </Col>
          </Row>
          <Form.Item name="type" label="调整类型" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="increase">
                <Space><PlusOutlined style={{ color: '#52c41a' }} /> 调增</Space>
              </Select.Option>
              <Select.Option value="decrease">
                <Space><MinusOutlined style={{ color: '#f5222d' }} /> 调减</Space>
              </Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="amount" label="调整金额" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber min={0.01} max={1000000} style={{ width: '100%' }} prefix="$" precision={2} placeholder="请输入金额" />
          </Form.Item>
          <Form.Item name="reason" label="调整原因" rules={[{ required: true, message: '请输入原因' }]}>
            <Input.TextArea rows={3} placeholder="请输入调整原因，便于审计追溯" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        title="钱包详情"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={800}
      >
        {detailData && (
          <>
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={8}><Statistic title="商户编号" value={detailData.user_no || '-'} /></Col>
              <Col span={8}><Statistic title="USD余额" value={detailData.balance_usd || 0} prefix="$" valueStyle={{ color: '#52c41a' }} /></Col>
              <Col span={8}><Statistic title="USDT余额" value={detailData.balance_usdt || 0} suffix="₮" /></Col>
            </Row>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>调整记录</Text>
            <Table columns={recordColumns} dataSource={records} rowKey="id" size="small" pagination={false} />
          </>
        )}
      </Modal>
    </div>
  )
}
