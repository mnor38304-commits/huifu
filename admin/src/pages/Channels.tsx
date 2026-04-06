import { useState, useEffect } from 'react'
import { Table, Button, Tag, Card, Modal, Form, Input, Select, message, Tabs, Spin, Alert, Badge, Tooltip, Divider } from 'antd'
import { PlusOutlined, EditOutlined, ApiOutlined, SyncOutlined, CreditCardOutlined, ReloadOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { getChannels, createChannel, updateChannel, getChannelBins, syncChannelBins } from '../api'

const { Option } = Select

// 已知支持BIN获取的渠道列表
const BIN_SUPPORTED_CHANNELS = ['dogpay']

export default function Channels() {
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editRecord, setEditRecord] = useState<any>(null)
  const [form] = Form.useForm()

  // BIN相关状态
  const [activeTab, setActiveTab] = useState('config')
  const [binList, setBinList] = useState<any[]>([])
  const [binLoading, setBinLoading] = useState(false)
  const [binSyncing, setBinSyncing] = useState(false)
  const [binError, setBinError] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getChannels()
      if (r.code === 0) setList(r.data)
    } finally { setLoading(false) }
  }

  const openCreate = () => {
    setEditRecord(null)
    setActiveTab('config')
    setBinList([])
    setBinError(null)
    form.resetFields()
    setModalVisible(true)
  }

  const openEdit = (r: any) => {
    setEditRecord(r)
    setActiveTab('config')
    setBinList([])
    setBinError(null)
    form.setFieldsValue({
      channelCode: r.channel_code,
      channelName: r.channel_name,
      apiBaseUrl: r.api_base_url,
      status: r.status
    })
    setModalVisible(true)
  }

  const onSubmit = async (values: any) => {
    try {
      const r: any = editRecord ? await updateChannel(editRecord.id, values) : await createChannel(values)
      if (r.code === 0) {
        message.success(editRecord ? '更新成功' : '创建成功')
        setModalVisible(false)
        load()
      } else message.error(r.message)
    } catch (e: any) { message.error(e.response?.data?.message || '操作失败') }
  }

  // 拉取渠道BIN列表（实时，不写库）
  const handleFetchBins = async () => {
    if (!editRecord) return
    setBinLoading(true)
    setBinError(null)
    setBinList([])
    try {
      const r: any = await getChannelBins(editRecord.id)
      if (r.code === 0) {
        setBinList(r.data.list || [])
        if ((r.data.list || []).length === 0) {
          setBinError('渠道未返回可用的BIN列表，请确认API配置正确且账户已开通相应权限')
        }
      } else {
        setBinError(r.message || '获取失败')
      }
    } catch (e: any) {
      setBinError(e.response?.data?.message || e.message || '网络请求失败')
    } finally {
      setBinLoading(false)
    }
  }

  // 同步BIN到本系统数据库
  const handleSyncBins = async () => {
    if (!editRecord) return
    if (editRecord.status !== 1) {
      message.warning('请先启用该渠道再同步BIN')
      return
    }
    setBinSyncing(true)
    try {
      const r: any = await syncChannelBins(editRecord.id)
      if (r.code === 0) {
        message.success(r.message)
        // 刷新BIN列表
        handleFetchBins()
      } else {
        message.error(r.message)
      }
    } catch (e: any) {
      message.error(e.response?.data?.message || '同步失败')
    } finally {
      setBinSyncing(false)
    }
  }

  // 当切换到BIN Tab时自动拉取
  const onTabChange = (key: string) => {
    setActiveTab(key)
    if (key === 'bins' && editRecord && binList.length === 0 && !binError) {
      handleFetchBins()
    }
  }

  const channelLogos: Record<string, string> = {
    AIRWALLEX: '🌐', PHOTON: '⚡', CUSTOM: '🔧', dogpay: '🐶', DOGPAY: '🐶'
  }

  const isBinSupported = (channelCode: string) =>
    BIN_SUPPORTED_CHANNELS.includes(channelCode?.toLowerCase())

  const cols = [
    {
      title: '渠道代码', dataIndex: 'channel_code', key: 'channel_code', width: 130,
      render: (v: string) => <span>{channelLogos[v] || '🔌'} {v}</span>
    },
    { title: '渠道名称', dataIndex: 'channel_name', key: 'channel_name', width: 150 },
    { title: 'API地址', dataIndex: 'api_base_url', key: 'api_base_url' },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: number) => <Tag color={v === 1 ? 'green' : 'default'}>{v === 1 ? '已启用' : '已禁用'}</Tag>
    },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: any, r: any) => (
        <>
          <Button type="link" size="small" onClick={() => openEdit(r)}><EditOutlined /> 配置</Button>
          {isBinSupported(r.channel_code) && (
            <Button type="link" size="small" onClick={() => { openEdit(r); setTimeout(() => onTabChange('bins'), 100) }}>
              <CreditCardOutlined /> 查看BIN
            </Button>
          )}
        </>
      )
    }
  ]

  // BIN列表的列定义（适配DogPay响应结构）
  const binCols = [
    {
      title: 'BIN ID / 渠道ID',
      key: 'id',
      width: 140,
      render: (r: any) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.id || r.channelId || r.channel_id || r.binId || '-'}</span>
    },
    {
      title: 'BIN码',
      key: 'bin_code',
      width: 100,
      render: (r: any) => {
        const code = r.binCode || r.bin_code || r.bin || r.cardBin || r.card_bin || '-'
        return <Tag color="blue" style={{ fontFamily: 'monospace' }}>{code}</Tag>
      }
    },
    {
      title: 'BIN名称',
      key: 'name',
      render: (r: any) => r.binName || r.bin_name || r.name || r.productName || '-'
    },
    {
      title: '品牌',
      key: 'brand',
      width: 90,
      render: (r: any) => {
        const brand = r.cardBrand || r.card_brand || r.brand || 'VISA'
        return <Tag color={brand === 'VISA' ? 'blue' : 'orange'}>{brand}</Tag>
      }
    },
    {
      title: '币种',
      key: 'currency',
      width: 80,
      render: (r: any) => r.currency || r.currencyCode || 'USD'
    },
    {
      title: '发卡机构',
      key: 'issuer',
      width: 120,
      render: (r: any) => r.issuer || '-'
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (r: any) => {
        const disabled = r.status === 0 || r.status === 'disabled'
        return <Tag color={disabled ? 'default' : 'green'}>{disabled ? '禁用' : '可用'}</Tag>
      }
    },
  ]

  const configTab = (
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
        <Select>
          <Option value={1}>启用</Option>
          <Option value={0}>禁用</Option>
        </Select>
      </Form.Item>
    </Form>
  )

  const binsTab = (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontWeight: 500 }}>渠道开通的卡BIN列表</span>
          <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>
            （来自 {editRecord?.channel_name} API 实时数据）
          </span>
          {binList.length > 0 && (
            <Badge count={binList.length} style={{ backgroundColor: '#52c41a', marginLeft: 8 }} />
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Tooltip title="从渠道API实时拉取BIN列表（不修改系统数据）">
            <Button icon={<ReloadOutlined />} onClick={handleFetchBins} loading={binLoading} size="small">
              刷新拉取
            </Button>
          </Tooltip>
          <Tooltip title={editRecord?.status !== 1 ? '渠道未启用' : '将此渠道的BIN同步写入系统BIN费率管理'}>
            <Button
              icon={<SyncOutlined />}
              onClick={handleSyncBins}
              loading={binSyncing}
              type="primary"
              size="small"
              disabled={editRecord?.status !== 1 || binList.length === 0}
            >
              同步到系统
            </Button>
          </Tooltip>
        </div>
      </div>

      {!editRecord?.api_key && (
        <Alert
          type="warning"
          message="渠道未配置 API Key"
          description="请先在「渠道配置」Tab中填写 API Key 和 API Secret，保存后再获取BIN列表。"
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      {binError && !binLoading && (
        <Alert
          type="error"
          message="获取BIN列表失败"
          description={binError}
          showIcon
          style={{ marginBottom: 12 }}
          action={<Button size="small" onClick={handleFetchBins}>重试</Button>}
        />
      )}

      {binLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="正在从渠道API拉取BIN列表..." />
        </div>
      ) : binList.length > 0 ? (
        <>
          <Alert
            type="info"
            showIcon
            icon={<CheckCircleOutlined />}
            message={`共获取到 ${binList.length} 个可用BIN`}
            description='点击「同步到系统」可将这些BIN写入系统的BIN费率管理，商户开卡时可使用。'
            style={{ marginBottom: 12 }}
          />
          <Table
            columns={binCols}
            dataSource={binList}
            rowKey={(r: any) => r.id || r.channelId || r.binId || JSON.stringify(r)}
            size="small"
            pagination={{ pageSize: 10, size: 'small' }}
            scroll={{ x: 700 }}
          />
        </>
      ) : !binError ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#999' }}>
          <CreditCardOutlined style={{ fontSize: 32, marginBottom: 12, display: 'block' }} />
          <p>点击「刷新拉取」从渠道API获取可用BIN列表</p>
        </div>
      ) : null}
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom: 16, padding: '16px 20px', background: '#fff7e6', borderRadius: 8, border: '1px solid #ffd591' }}>
        <strong>💡 渠道对接说明</strong>
        <p style={{ margin: '8px 0 0', color: '#666', fontSize: 13 }}>
          支持对接空中云汇（Airwallex）、光子易（Photon）等主流虚拟卡发卡渠道。
          配置 API Key 和 Secret 后，系统将自动通过渠道 API 完成开卡、充值、交易等操作。
          <strong> 在渠道配置中可直接获取该渠道开通的卡BIN，并一键同步到系统。</strong>
        </p>
      </div>

      <Card style={{ borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>卡渠道管理</span>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加渠道</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          {list.map(ch => (
            <Card key={ch.id} size="small" style={{ borderRadius: 8, border: ch.status === 1 ? '1px solid #52c41a' : '1px solid #d9d9d9' }}
              extra={
                <div style={{ display: 'flex', gap: 4 }}>
                  {isBinSupported(ch.channel_code) && (
                    <Tooltip title="查看渠道开通的卡BIN">
                      <Button type="link" size="small" style={{ padding: '0 4px' }}
                        onClick={() => { openEdit(ch); setTimeout(() => onTabChange('bins'), 100) }}>
                        <CreditCardOutlined />
                      </Button>
                    </Tooltip>
                  )}
                  <Button type="link" size="small" onClick={() => openEdit(ch)}>配置</Button>
                </div>
              }>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 32 }}>{channelLogos[ch.channel_code] || '🔌'}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{ch.channel_name}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{ch.channel_code}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
                    <Tag color={ch.status === 1 ? 'green' : 'default'} style={{ margin: 0 }}>
                      {ch.status === 1 ? '已启用' : '已禁用'}
                    </Tag>
                    {isBinSupported(ch.channel_code) && (
                      <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>支持BIN获取</Tag>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: '#666', wordBreak: 'break-all' }}>{ch.api_base_url}</div>
            </Card>
          ))}
        </div>

        <Table columns={cols} dataSource={list} rowKey="id" loading={loading} pagination={false} />
      </Card>

      <Modal
        title={editRecord ? `渠道设置: ${editRecord.channel_name}` : '添加渠道'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        width={700}
        footer={activeTab === 'config' ? undefined : null}
        onOk={() => form.submit()}
        okText={editRecord ? '保存' : '创建'}
        destroyOnClose
      >
        {editRecord && isBinSupported(editRecord.channel_code) ? (
          <Tabs
            activeKey={activeTab}
            onChange={onTabChange}
            items={[
              {
                key: 'config',
                label: <span><ApiOutlined /> 渠道配置</span>,
                children: configTab,
              },
              {
                key: 'bins',
                label: <span><CreditCardOutlined /> 获取卡BIN</span>,
                children: binsTab,
              },
            ]}
          />
        ) : configTab}
      </Modal>
    </div>
  )
}
