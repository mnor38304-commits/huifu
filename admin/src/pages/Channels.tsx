import { useState, useEffect } from 'react'
import { Table, Button, Tag, Space, Card, Modal, Form, Input, Select, message, Popconfirm } from 'antd'
import { PlusOutlined, EditOutlined, ApiOutlined, SyncOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { getChannels, createChannel, updateChannel, syncDogPayBins, syncGeoBins } from '../api'

const { Option } = Select

// CoinPal 是 USDT 收款渠道，不在发卡渠道列表里显示
const USDT_CHANNELS = ['COINPAL']

export default function Channels() {
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editRecord, setEditRecord] = useState<any>(null)
  const [form] = Form.useForm()
  // 每个渠道独立的 syncing 状态，key 为 channel.id
  const [syncingId, setSyncingId] = useState<number | null>(null)

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

  // 同步指定渠道的 BIN（按渠道代码分发）
  const handleSyncBins = async (ch: any) => {
    setSyncingId(ch.id)
    try {
      const code = (ch.channel_code || '').toUpperCase()
      let r: any
      if (code === 'GEO') {
        r = await syncGeoBins()
      } else {
        r = await syncDogPayBins()
      }
      if (r.code === 0) {
        message.success(`[${ch.channel_name}] BIN 同步成功！新增: ${r.data?.synced || 0} 个`)
      } else {
        message.error(r.message || '同步失败')
      }
    } catch (e: any) {
      message.error(e.response?.data?.message || '同步失败')
    } finally {
      setSyncingId(null)
    }
  }

  const channelLogos: Record<string, string> = {
    AIRWALLEX: '🌐', PHOTON: '⚡', DOGPAY: '🐕', GEO: '🌍', CUSTOM: '🔧'
  }

  // 解析渠道 config_json 中的 GEO 灰度配置（脱敏安全，不暴露密钥）
  const getGeoCanaryTags = (ch: any): React.ReactNode[] => {
    if ((ch.channel_code || '').toUpperCase() !== 'GEO') return []
    let cfg: any = {}
    try { cfg = JSON.parse(ch.config_json || '{}') } catch (_) {}
    const tags: React.ReactNode[] = []
    if (cfg.readonly === true) tags.push(<Tag key="ro" color="orange">只读</Tag>)
    else if (cfg.readonly === false) tags.push(<Tag key="ro" color="green">可写</Tag>)
    tags.push(cfg.enableCreateCard === true
      ? <Tag key="ecc" color="blue">开卡:开</Tag>
      : <Tag key="ecc">开卡:关</Tag>)
    tags.push(cfg.createCardCanaryEnabled === true
      ? <Tag key="can" color="purple">灰度:开</Tag>
      : <Tag key="can">灰度:关</Tag>)
    return tags
  }

  // 获取 GEO 已同步 BIN 数量
  const getGeoBinCount = (ch: any): string => {
    // 直接从外部状态读取，通过 API 即可获得
    return ''
  }

  // 只展示发卡渠道（排除 USDT 收款渠道）
  const cardChannels = list.filter(ch => !USDT_CHANNELS.includes(ch.channel_code?.toUpperCase()))

  const cols = [
    { title: '渠道代码', dataIndex: 'channel_code', key: 'channel_code', width: 130,
      render: (v: string) => <span>{channelLogos[v] || '🔌'} {v}</span> },
    { title: '渠道名称', dataIndex: 'channel_name', key: 'channel_name', width: 150 },
    { title: 'API地址', dataIndex: 'api_base_url', key: 'api_base_url' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: number) => <Tag color={v===1?'green':'default'}>{v===1?'已启用':'已禁用'}</Tag> },
    { title: '操作', key: 'action', width: 160,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(r)}><EditOutlined /> 配置</Button>
          <Popconfirm
            title={`同步 [${r.channel_name}] 卡 BIN？`}
            description="将从渠道接口拉取最新卡 BIN 数据并同步到本地。"
            onConfirm={() => handleSyncBins(r)}
            okText="同步"
            cancelText="取消"
          >
            <Button type="link" size="small" loading={syncingId === r.id} icon={<SyncOutlined spin={syncingId === r.id} />}>
              同步卡Bin
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, padding: '16px 20px', background: '#fff7e6', borderRadius: 8, border: '1px solid #ffd591' }}>
        <strong>💡 渠道对接说明</strong>
        <p style={{ margin: '8px 0 0', color: '#666', fontSize: 13 }}>
          此处管理发卡渠道对接（DogPay、空中云汇、光子易等虚拟卡发卡通道）。
          配置 API Key 和 Secret 后，系统将通过渠道 API 完成开卡、充值、交易等操作。
          每个渠道可单独点击「同步卡Bin」从渠道接口拉取最新 BIN 数据。
          USDT 收款渠道（CoinPal）请在左侧菜单「USDT充值 → 收款渠道设置」中配置。
        </p>
      </div>

      <Card style={{ borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>发卡渠道管理</span>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加渠道</Button>
        </div>

        {/* 渠道卡片区：每张卡片底部独立显示「同步卡Bin」操作 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          {cardChannels.map(ch => (
            <Card
              key={ch.id}
              size="small"
              style={{ borderRadius: 8, border: ch.status===1 ? '1px solid #52c41a' : '1px solid #d9d9d9' }}
              extra={<Button type="link" size="small" onClick={() => openEdit(ch)}><EditOutlined /> 配置</Button>}
              actions={[
                <Popconfirm
                  key="sync"
                  title={`同步 [${ch.channel_name}] 卡 BIN？`}
                  description="将从渠道接口拉取最新卡 BIN 数据并同步到本地。"
                  onConfirm={() => handleSyncBins(ch)}
                  okText="同步"
                  cancelText="取消"
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<SyncOutlined spin={syncingId === ch.id} />}
                    loading={syncingId === ch.id}
                    style={{ color: '#1890ff' }}
                  >
                    同步卡Bin
                  </Button>
                </Popconfirm>
              ]}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 32 }}>{channelLogos[ch.channel_code] || '🔌'}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{ch.channel_name}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{ch.channel_code}</div>
                  <Tag color={ch.status===1 ? 'green' : 'default'} style={{ marginTop: 4 }}>
                    {ch.status===1 ? '已启用' : '已禁用'}
                  </Tag>
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#666', wordBreak: 'break-all' }}>
                {ch.api_base_url}
              </div>
              {(ch.channel_code || '').toUpperCase() === 'GEO' && (
                <div style={{ marginTop: 8 }}>
                  {getGeoCanaryTags(ch)}
                </div>
              )}
            </Card>
          ))}
          {cardChannels.length === 0 && !loading && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#999', padding: '40px 0' }}>
              暂无发卡渠道，点击右上角「添加渠道」开始对接
            </div>
          )}
        </div>

        <Table columns={cols} dataSource={cardChannels} rowKey="id" loading={loading} pagination={false} />
      </Card>

      <Modal title={editRecord ? `配置渠道: ${editRecord.channel_name}` : '添加发卡渠道'} open={modalVisible}
        onCancel={() => setModalVisible(false)} onOk={() => form.submit()} width={560}>
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="channelCode" label="渠道代码" rules={[{ required: true }]}>
            <Input placeholder="如: DOGPAY" disabled={!!editRecord} />
          </Form.Item>
          <Form.Item name="channelName" label="渠道名称" rules={[{ required: true }]}>
            <Input placeholder="如: DogPay 虚拟卡" />
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
