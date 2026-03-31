import { useState, useEffect } from 'react'
import { Table, Button, Tag, Space, Card, Modal, Form, Input, Select, message, Switch, Descriptions } from 'antd'
import { PlusOutlined, EditOutlined, ApiOutlined } from '@ant-design/icons'
import { getChannels, createChannel, updateChannel } from '../api'

const { Option } = Select

export default function Channels() {
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editRecord, setEditRecord] = useState<any>(null)
  const [form] = Form.useForm()

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getChannels()
      if (r.code === 0) setList(r.data)
    } finally { setLoading(false) }
  }

  const openCreate = () => { setEditRecord(null); form.resetFields(); setModalVisible(true) }
  const openEdit = (r: any) => {
    setEditRecord(r)
    form.setFieldsValue({ channelCode: r.channel_code, channelName: r.channel_name, apiBaseUrl: r.api_base_url, status: r.status })
    setModalVisible(true)
  }

  const onSubmit = async (values: any) => {
    try {
      const r: any = editRecord ? await updateChannel(editRecord.id, values) : await createChannel(values)
      if (r.code === 0) { message.success(editRecord ? '更新成功' : '创建成功'); setModalVisible(false); load() }
      else message.error(r.message)
    } catch (e: any) { message.error(e.response?.data?.message || '操作失败') }
  }

  const channelLogos: Record<string, string> = {
    AIRWALLEX: '🌐', PHOTON: '⚡', CUSTOM: '🔧'
  }

  const cols = [
    { title: '渠道代码', dataIndex: 'channel_code', key: 'channel_code', width: 130,
      render: (v: string) => <span>{channelLogos[v] || '🔌'} {v}</span> },
    { title: '渠道名称', dataIndex: 'channel_name', key: 'channel_name', width: 150 },
    { title: 'API地址', dataIndex: 'api_base_url', key: 'api_base_url' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: number) => <Tag color={v===1?'green':'default'}>{v===1?'已启用':'已禁用'}</Tag> },
    { title: '操作', key: 'action', width: 100,
      render: (_: any, r: any) => <Button type="link" size="small" onClick={() => openEdit(r)}><EditOutlined /> 配置</Button> }
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, padding: '16px 20px', background: '#fff7e6', borderRadius: 8, border: '1px solid #ffd591' }}>
        <strong>💡 渠道对接说明</strong>
        <p style={{ margin: '8px 0 0', color: '#666', fontSize: 13 }}>
          支持对接空中云汇（Airwallex）、光子易（Photon）等主流虚拟卡发卡渠道。
          配置 API Key 和 Secret 后，系统将自动通过渠道 API 完成开卡、充值、交易等操作。
          Webhook 密钥用于验证渠道回调通知的真实性。
        </p>
      </div>

      <Card style={{ borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>卡渠道管理</span>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加渠道</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          {list.map(ch => (
            <Card key={ch.id} size="small" style={{ borderRadius: 8, border: ch.status===1?'1px solid #52c41a':'1px solid #d9d9d9' }}
              extra={<Button type="link" size="small" onClick={() => openEdit(ch)}>配置</Button>}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 32 }}>{channelLogos[ch.channel_code] || '🔌'}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{ch.channel_name}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{ch.channel_code}</div>
                  <Tag color={ch.status===1?'green':'default'} style={{ marginTop: 4 }}>{ch.status===1?'已启用':'已禁用'}</Tag>
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#666', wordBreak: 'break-all' }}>{ch.api_base_url}</div>
            </Card>
          ))}
        </div>

        <Table columns={cols} dataSource={list} rowKey="id" loading={loading} pagination={false} />
      </Card>

      <Modal title={editRecord ? `配置渠道: ${editRecord.channel_name}` : '添加渠道'} open={modalVisible}
        onCancel={() => setModalVisible(false)} onOk={() => form.submit()} width={560}>
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="channelCode" label="渠道代码" rules={[{ required: true }]}>
            <Input placeholder="如: AIRWALLEX" disabled={!!editRecord} />
          </Form.Item>
          <Form.Item name="channelName" label="渠道名称" rules={[{ required: true }]}>
            <Input placeholder="如: 空中云汇" />
          </Form.Item>
          <Form.Item name="apiBaseUrl" label="API 基础地址">
            <Input placeholder="https://api.example.com" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password placeholder="API Key（留空则不修改）" />
          </Form.Item>
          <Form.Item name="apiSecret" label="API Secret">
            <Input.Password placeholder="API Secret（留空则不修改）" />
          </Form.Item>
          <Form.Item name="webhookSecret" label="Webhook 验签密钥">
            <Input.Password placeholder="用于验证渠道回调通知" />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue={1}>
            <Select><Option value={1}>启用</Option><Option value={0}>禁用</Option></Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
