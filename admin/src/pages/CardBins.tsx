import { useState, useEffect } from 'react'
import { Table, Button, Tag, Card, Modal, Form, Input, InputNumber, Select, message, Tooltip, Divider } from 'antd'
import { EditOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { getBins, updateBin, bulkUpdateBinRates } from '../api'

const { Option } = Select

const feeFields = [
  { name: 'openFee', label: '开卡费', unit: 'USD', tip: '每张卡开卡时收取的固定费用' },
  { name: 'topupFeeRate', label: '充值手续费率', unit: '%', tip: '商户向卡充值时收取的费率', isRate: true },
  { name: 'topupFeeMin', label: '充值最低手续费', unit: 'USD', tip: '充值手续费的最低收取金额' },
  { name: 'crossBorderFeeRate', label: '跨境手续费率', unit: '%', tip: '跨境交易额外收取的费率', isRate: true },
  { name: 'smallTxnThreshold', label: '小额交易阈值', unit: 'USD', tip: '低于此金额的交易视为小额交易' },
  { name: 'smallTxnFee', label: '小额交易手续费', unit: 'USD', tip: '小额交易收取的固定手续费' },
  { name: 'declineFee', label: '余额不足拒绝费', unit: 'USD', tip: '因余额不足导致交易失败时收取' },
  { name: 'authFee', label: '授权手续费', unit: 'USD', tip: '每次预授权收取的费用' },
  { name: 'refundFeeRate', label: '退款手续费率', unit: '%', tip: '退款时收取的费率', isRate: true },
  { name: 'monthlyFee', label: '月费', unit: 'USD/月', tip: '每张卡每月收取的维护费' },
]

export default function CardBins() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [batchVisible, setBatchVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [editRecord, setEditRecord] = useState<any>(null)
  const [form] = Form.useForm()
  const [batchForm] = Form.useForm()
  const [channelFilter, setChannelFilter] = useState('ALL')

  useEffect(() => { load() }, [channelFilter])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getBins({ page: 1, pageSize: 50, channelCode: channelFilter })
      if (r.code === 0) { setList(r.data.list); setTotal(r.data.total) }
      else if (r.code === 401) { /* 未登录，已由 interceptor 统一处理重定向 */ }
    } catch (e: any) {
      console.error('[CardBins] load failed:', e)
    } finally { setLoading(false) }
  }

  const openEdit = (record: any) => {
    setEditRecord(record)
    form.setFieldsValue({
      binCode: record.bin_code, binName: record.bin_name, cardBrand: record.card_brand,
      issuer: record.issuer, currency: record.currency, country: record.country, status: record.status,
      openFee: record.open_fee, topupFeeRate: record.topup_fee_rate * 100, topupFeeMin: record.topup_fee_min,
      crossBorderFeeRate: record.cross_border_fee_rate * 100, smallTxnThreshold: record.small_txn_threshold,
      smallTxnFee: record.small_txn_fee, declineFee: record.decline_fee, authFee: record.auth_fee,
      refundFeeRate: record.refund_fee_rate * 100, monthlyFee: record.monthly_fee,
    })
    setModalVisible(true)
  }

  const onSubmit = async (values: any) => {
    const data = { ...values, topupFeeRate: values.topupFeeRate/100, crossBorderFeeRate: values.crossBorderFeeRate/100, refundFeeRate: values.refundFeeRate/100 }
    try {
      const r: any = await updateBin(editRecord.id, data)
      if (r.code === 0) { message.success('更新成功'); setModalVisible(false); load() }
      else message.error(r.message)
    } catch (e: any) { message.error(e.response?.data?.message || '操作失败') }
  }

  const openBatch = () => {
    if (!selectedRowKeys.length) return message.warning('请先选择BIN')
    batchForm.resetFields()
    setBatchVisible(true)
  }

  const onBatchSubmit = async (values: any) => {
    const data: any = {}
    feeFields.forEach((f) => {
      const v = values[f.name]
      if (v !== undefined && v !== null && v !== '') {
        data[f.name] = f.isRate ? v / 100 : v
      }
    })
    if (!Object.keys(data).length) return message.warning('请至少填写一个费率字段')
    setSubmitting(true)
    try {
      const r: any = await bulkUpdateBinRates(selectedRowKeys, data)
      if (r.code === 0) {
        message.success('批量费率设置成功')
        setBatchVisible(false)
        setSelectedRowKeys([])
        load()
      } else message.error(r.message)
    } catch (e: any) {
      message.error(e.response?.data?.message || '批量设置失败')
    } finally {
      setSubmitting(false)
    }
  }

  const cols = [
    { title: '发卡机构', dataIndex: 'channel_code', key: 'channel_code', width: 100, render: (v: string) => <Tag color={v==='UQPAY'?'blue':'green'}>{v}</Tag> },
    { title: 'BIN码', dataIndex: 'bin_code', key: 'bin_code', width: 100 },
    { title: 'BIN名称', dataIndex: 'bin_name', key: 'bin_name', width: 160 },
    { title: '品牌', dataIndex: 'card_brand', key: 'card_brand', width: 80, render: (v: string) => <Tag color={v==='VISA'?'blue':'orange'}>{v}</Tag> },
    { title: '发卡机构', dataIndex: 'issuer', key: 'issuer', width: 120 },
    { title: '开卡费', dataIndex: 'open_fee', key: 'open_fee', width: 90, render: (v: number) => `$${v}` },
    { title: '充值费率', dataIndex: 'topup_fee_rate', key: 'topup_fee_rate', width: 90, render: (v: number) => `${(v*100).toFixed(1)}%` },
    { title: '跨境费率', dataIndex: 'cross_border_fee_rate', key: 'cross_border_fee_rate', width: 90, render: (v: number) => `${(v*100).toFixed(1)}%` },
    { title: '拒绝费', dataIndex: 'decline_fee', key: 'decline_fee', width: 80, render: (v: number) => `$${v}` },
    { title: '月费', dataIndex: 'monthly_fee', key: 'monthly_fee', width: 80, render: (v: number) => `$${v}` },
    { title: '卡片数', dataIndex: 'card_count', key: 'card_count', width: 80 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: number) => <Tag color={v===1?'green':'default'}>{v===1?'启用':'禁用'}</Tag> },
    { title: '操作', key: 'action', fixed: 'right' as const, width: 80, render: (_: any, r: any) => <Button type="link" size="small" onClick={() => openEdit(r)}><EditOutlined /> 编辑</Button> }
  ]

  return (
    <div>
      <Card style={{ borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 16, fontWeight: 600 }}>卡 BIN 费率管理</span>
            <span style={{ color: '#999', fontSize: 13, marginLeft: 8 }}>共 {total} 个BIN</span>
            <Select value={channelFilter} onChange={v => setChannelFilter(v)} style={{ width: 120, marginLeft: 16 }} size="small">
              <Option value="ALL">全部</Option>
              <Option value="UQPAY">UQPAY</Option>
              <Option value="GEO">GEO</Option>
            </Select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={openBatch} disabled={!selectedRowKeys.length}>批量费率设置</Button>
          </div>
        </div>
        <Table rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} columns={cols} dataSource={list} rowKey="id" loading={loading} scroll={{ x: 1200 }} pagination={false} />
      </Card>

      <Modal title={editRecord ? '编辑BIN费率' : '新增BIN'} open={modalVisible} onCancel={() => setModalVisible(false)} onOk={() => form.submit()} width={700} okText={editRecord ? '保存' : '创建'}>
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Divider orientation="left" plain>基本信息</Divider>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="binCode" label="BIN码" rules={[{ required: true }]}><Input placeholder="如: 411111" disabled={!!editRecord} /></Form.Item>
            <Form.Item name="binName" label="BIN名称" rules={[{ required: true }]}><Input placeholder="如: Visa Standard USD" /></Form.Item>
            <Form.Item name="cardBrand" label="卡品牌" initialValue="VISA"><Select><Option value="VISA">VISA</Option><Option value="MC">Mastercard</Option></Select></Form.Item>
            <Form.Item name="issuer" label="发卡机构"><Input placeholder="发卡银行名称" /></Form.Item>
            <Form.Item name="currency" label="币种" initialValue="USD"><Select><Option value="USD">USD</Option><Option value="EUR">EUR</Option><Option value="GBP">GBP</Option></Select></Form.Item>
            <Form.Item name="status" label="状态" initialValue={1}><Select><Option value={1}>启用</Option><Option value={0}>禁用</Option></Select></Form.Item>
          </div>
          <Divider orientation="left" plain>费率配置</Divider>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            {feeFields.map(f => (
              <Form.Item key={f.name} name={f.name} initialValue={0} label={<span>{f.label} <Tooltip title={f.tip}><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>}>
                <InputNumber min={0} max={f.isRate ? 100 : undefined} step={f.isRate ? 0.1 : 0.01} addonAfter={f.unit} style={{ width: '100%' }} />
              </Form.Item>
            ))}
          </div>
        </Form>
      </Modal>

      <Modal title={`批量设置费率（已选 ${selectedRowKeys.length} 个BIN）`} open={batchVisible} onCancel={() => setBatchVisible(false)} onOk={() => batchForm.submit()} okButtonProps={{ loading: submitting }} width={700} okText="应用到所选BIN">
        <Form form={batchForm} layout="vertical" onFinish={onBatchSubmit}>
          <div style={{ marginBottom: 12, color: '#999' }}>只会更新你填写的字段，留空字段保持原值不变。</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            {feeFields.map(f => (
              <Form.Item key={f.name} name={f.name} label={<span>{f.label} <Tooltip title={f.tip}><InfoCircleOutlined style={{ color: '#999' }} /></Tooltip></span>}>
                <InputNumber min={0} max={f.isRate ? 100 : undefined} step={f.isRate ? 0.1 : 0.01} addonAfter={f.unit} style={{ width: '100%' }} placeholder="留空则不修改" />
              </Form.Item>
            ))}
          </div>
        </Form>
      </Modal>
    </div>
  )
}
