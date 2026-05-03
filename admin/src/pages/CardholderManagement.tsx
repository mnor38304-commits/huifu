import { useState, useEffect, useRef } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Upload, Alert, Row, Col, Statistic, Spin } from 'antd'
import { PlusOutlined, DownloadOutlined, UploadOutlined, EyeOutlined, DeleteOutlined } from '@ant-design/icons'
import { getCardholders, createCardholder, batchValidateCardholders, batchCreateCardholders, downloadCardholderTemplate, getCardholderSchema, getCardholderChannelList } from '../api'
import type { ColumnsType } from 'antd/es/table'

const { Option } = Select

// ── GEO mobilePrefix 联动 ──────────────────────────────────────────────────
const MOBILE_PREFIX_MAP: Record<string, string> = { USA: '1', SG: '65', HK: '852' }

// ── 动态表单字段渲染 ─────────────────────────────────────────────────────────
function renderField(field: any, form: any, channelCode: string) {
  const { name, label, type, required, placeholder, options, patternMessage, description } = field
  const rules: any[] = []
  if (required) rules.push({ required: true, message: `${label} 必填` })
  if (type === 'email') rules.push({ type: 'email', message: '邮箱格式不正确' })
  if (name === 'birthDate') rules.push({ pattern: /^\d{4}-\d{2}-\d{2}$/, message: '格式必须为 YYYY-MM-DD' })

  // GEO 国家选择 → 自动联动 mobilePrefix
  if (name === 'countryCode' && channelCode === 'GEO') {
    return (
      <Form.Item key={name} name={name} label={label} rules={rules} initialValue="USA">
        <Select placeholder={placeholder || `选择${label}`} style={{ width: 120 }}
          onChange={(val) => {
            // 自动填写 mobilePrefix
            form.setFieldsValue({ mobilePrefix: MOBILE_PREFIX_MAP[val] || '1' })
            // billingCountry 默认跟 countryCode 一致（如果当前为空或同值）
            const bc = form.getFieldValue('billingCountry')
            if (!bc || bc === (form.getFieldValue('countryCode_old') || 'USA')) {
              form.setFieldsValue({ billingCountry: val })
            }
            form.setFieldsValue({ countryCode_old: val })
          }}
        >
          <Option value="USA">USA</Option>
          <Option value="SG">SG</Option>
          <Option value="HK">HK</Option>
        </Select>
      </Form.Item>
    )
  }

  // GEO billingCountry 选择
  if (name === 'billingCountry' && channelCode === 'GEO') {
    return (
      <Form.Item key={name} name={name} label={label} rules={rules} initialValue="USA">
        <Select placeholder={placeholder || `选择${label}`} style={{ width: 120 }}>
          <Option value="USA">USA</Option>
          <Option value="SG">SG</Option>
          <Option value="HK">HK</Option>
        </Select>
      </Form.Item>
    )
  }

  // GEO mobilePrefix 自动填写
  if (name === 'mobilePrefix' && channelCode === 'GEO') {
    return (
      <Form.Item key={name} name={name} label={label} rules={rules} initialValue="1">
        <Input placeholder={placeholder || '1'} disabled style={{ width: 100 }} />
      </Form.Item>
    )
  }

  // select 类型
  if (type === 'select' && options && Array.isArray(options)) {
    return (
      <Form.Item key={name} name={name} label={label} rules={rules} initialValue={field.defaultValue}>
        <Select placeholder={placeholder || `选择${label}`} style={{ width: '100%' }}>
          {(options as { value: any; label: string }[]).map((o: { value: any; label: string }) => (
            <Option key={String(o.value)} value={o.value}>{o.label}</Option>
          ))}
        </Select>
      </Form.Item>
    )
  }

  // text / email / tel
  return (
    <Form.Item key={name} name={name} label={<span>{label} {description && <span style={{ color: '#999', fontSize: 12 }}>({description})</span>}</span>} rules={rules} initialValue={field.defaultValue}>
      <Input placeholder={placeholder || `请输入${label}`} type={type === 'email' ? 'email' : 'text'} />
    </Form.Item>
  )
}

// ── 主组件 ──────────────────────────────────────────────────────────────────

const CardholderManagement: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [filters, setFilters] = useState<any>({ channel: 'ALL' })
  const [channels, setChannels] = useState<string[]>([])

  // 单个添加
  const [addModal, setAddModal] = useState(false)
  const [addForm] = Form.useForm()
  const [addLoading, setAddLoading] = useState(false)
  const [addChannel, setAddChannel] = useState('UQPAY')
  const [addSchema, setAddSchema] = useState<any>(null)
  const [addSchemaLoading, setAddSchemaLoading] = useState(false)

  // 批量添加
  const [batchModal, setBatchModal] = useState(false)
  const [batchChannel, setBatchChannel] = useState('UQPAY')
  const [batchData, setBatchData] = useState<any[]>([])
  const [batchRaw, setBatchRaw] = useState('')
  const [validateResult, setValidateResult] = useState<any>(null)
  const [batchCreating, setBatchCreating] = useState(false)
  const [batchResult, setBatchResult] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 详情
  const [detailModal, setDetailModal] = useState(false)
  const [detailData, setDetailData] = useState<any>(null)

  // 加载渠道列表
  useEffect(() => {
    getCardholderChannelList().then((r: any) => {
      if (r.code === 0) setChannels(r.data || [])
    }).catch(() => {})
  }, [])

  useEffect(() => { loadList() }, [page, filters])

  const loadList = async () => {
    setLoading(true)
    try {
      const r: any = await getCardholders({ page, pageSize, ...filters })
      if (r.code === 0) {
        setList(r.data.list || [])
        setTotal(r.data.total || 0)
      }
    } catch { message.error('加载失败') }
    finally { setLoading(false) }
  }

  // ── 打开新增弹窗 ──
  const openAddModal = async (channelCode: string) => {
    setAddChannel(channelCode)
    addForm.resetFields()
    setAddModal(true)
    await loadSchema(channelCode)
  }

  const loadSchema = async (channelCode: string) => {
    setAddSchemaLoading(true)
    try {
      const r: any = await getCardholderSchema(channelCode)
      if (r.code === 0) setAddSchema(r.data)
      else message.error(r.message || '加载字段定义失败')
    } catch { message.error('加载字段定义失败') }
    finally { setAddSchemaLoading(false) }
  }

  const handleAddChannelChange = async (val: string) => {
    setAddChannel(val)
    addForm.resetFields()
    await loadSchema(val)
  }

  // ── 单个提交 ──
  const handleAdd = async (values: any) => {
    setAddLoading(true)
    try {
      const payload = { channelCode: addChannel, ...values }
      // GEO 删除辅助字段
      delete payload.countryCode_old
      const r: any = await createCardholder(payload)
      if (r.code === 0) {
        message.success('创建成功')
        setAddModal(false)
        addForm.resetFields()
        loadList()
      } else message.error(r.message)
    } catch { message.error('创建失败') }
    finally { setAddLoading(false) }
  }

  // ── 批量预校验 ──
  const handleBatchValidate = async () => {
    try {
      let rows: any[]
      try {
        rows = JSON.parse(batchRaw)
      } catch {
        const lines = batchRaw.split('\n').filter(l => l.trim())
        const headers = lines[0].split(',').map(h => h.trim())
        rows = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim())
          const obj: any = {}
          headers.forEach((h, i) => { obj[h] = vals[i] || '' })
          return obj
        })
      }
      if (!rows.length) { message.warning('无有效数据'); return }
      const r: any = await batchValidateCardholders({ rows, channelCode: batchChannel })
      if (r.code === 0) {
        setValidateResult(r.data)
        setBatchData(rows)
      } else message.error(r.message)
    } catch { message.error('解析失败，请检查格式') }
  }

  // ── 批量创建 ──
  const handleBatchCreate = async () => {
    if (!batchData.length) return
    setBatchCreating(true)
    try {
      const r: any = await batchCreateCardholders({ rows: batchData, channelCode: batchChannel })
      if (r.code === 0) {
        setBatchResult(r.data)
        if (r.data.success > 0) {
          message.success(`成功创建 ${r.data.success} 条`)
          loadList()
        }
        if (r.data.failed > 0) message.warning(`${r.data.failed} 条创建失败`)
      } else message.error(r.message)
    } catch { message.error('批量创建失败') }
    finally { setBatchCreating(false) }
  }

  // ── CSV 文件上传 ──
  const handleFileUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setBatchRaw(e.target?.result as string || '')
      setValidateResult(null)
      setBatchResult(null)
      message.info('文件已加载，点击「预校验」进行校验')
    }
    reader.readAsText(file)
    // 阻止自动上传
    return false
  }

  const columns: ColumnsType<any> = [
    { title: 'ID', dataIndex: 'id', width: 50 },
    { title: '渠道', dataIndex: 'channel_code', width: 70 },
    { title: '外部ID', dataIndex: 'external_id', width: 120, render: (v: string) => v ? v.substring(0, 12) + '...' : '-' },
    { title: '姓名', dataIndex: 'first_name', width: 100, render: (_: any, r: any) => `${r.first_name || ''} ${r.last_name || ''}` },
    { title: '邮箱', dataIndex: 'email_masked', width: 140 },
    { title: '手机', dataIndex: 'phone_masked', width: 100 },
    { title: '国家', dataIndex: 'country_code', width: 50 },
    { title: '城市', dataIndex: 'city', width: 80, render: (v: string) => v || '-' },
    { title: '州/省', dataIndex: 'state', width: 60, render: (v: string) => v || '-' },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => {
        const color: Record<string, string> = { PENDING: 'blue', ACTIVE: 'green', FAILED: 'red', DISABLED: 'orange' }
        return <Tag color={color[v] || 'default'}>{v}</Tag>
      }
    },
    {
      title: 'KYC', dataIndex: 'kyc_status', width: 80,
      render: (v: string) => {
        const color: Record<string, string> = { PENDING: 'blue', APPROVED: 'green', REJECTED: 'red' }
        return <Tag color={color[v] || 'default'}>{v || '-'}</Tag>
      }
    },
    { title: '创建时间', dataIndex: 'created_at', width: 140, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
    {
      title: '操作', width: 60,
      render: (_: any, r: any) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setDetailData(r); setDetailModal(true) }}>详情</Button>
      ),
    },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>持卡人管理</h2>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select value={filters.channel || 'ALL'} style={{ width: 130 }}
            onChange={v => setFilters(f => ({ ...f, channel: v, page: 1 }))}>
            <Option value="ALL">全部渠道</Option>
            {channels.map(c => <Option key={c} value={c}>{c}</Option>)}
          </Select>
          <Select
            allowClear placeholder="状态" style={{ width: 120 }}
            onChange={v => setFilters(f => ({ ...f, status: v || undefined }))}
          >
            <Option value="PENDING">PENDING</Option>
            <Option value="ACTIVE">ACTIVE</Option>
            <Option value="FAILED">FAILED</Option>
          </Select>
          <Select
            allowClear placeholder="KYC" style={{ width: 120 }}
            onChange={v => setFilters(f => ({ ...f, kycStatus: v || undefined }))}
          >
            <Option value="PENDING">PENDING</Option>
            <Option value="APPROVED">APPROVED</Option>
            <Option value="REJECTED">REJECTED</Option>
          </Select>
          <Input.Search
            placeholder="关键字搜索" style={{ width: 200 }}
            onSearch={v => setFilters(f => ({ ...f, keyword: v || undefined }))}
          />
          {/* 新增持卡人 — 按渠道 */}
          {channels.filter(c => c !== 'DOGPAY').map(c => (
            <Button key={c} type="primary" icon={<PlusOutlined />} onClick={() => openAddModal(c)}>
              新增{c}
            </Button>
          ))}
          <Button icon={<UploadOutlined />} onClick={() => { setBatchModal(true); setBatchResult(null); setValidateResult(null); setBatchRaw(''); setBatchChannel('UQPAY') }}>
            批量导入
          </Button>
          {/* 模板下载 — 按渠道 */}
          {channels.filter(c => c !== 'DOGPAY').map(c => (
            <Button key={c} icon={<DownloadOutlined />} onClick={() => window.open(downloadCardholderTemplate(c))}>
              模板 {c}
            </Button>
          ))}
        </Space>
      </Card>

      <Table
        dataSource={list}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, total, pageSize, onChange: setPage }}
        scroll={{ x: 1200 }}
      />

      {/* ── 单个添加弹窗 ── */}
      <Modal title={`新增持卡人 - ${addChannel}`} open={addModal} onCancel={() => setAddModal(false)} footer={null} width={600} destroyOnClose>
        <Spin spinning={addSchemaLoading}>
          <Form form={addForm} layout="vertical" onFinish={handleAdd}>
            {addSchema && (
              <>
                <Alert message={`渠道: ${addChannel}`} type="info" showIcon style={{ marginBottom: 16 }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  {addSchema.fields?.map((f: any) => renderField(f, addForm, addChannel))}
                </div>
                <Button type="primary" htmlType="submit" loading={addLoading} block style={{ marginTop: 16 }}>
                  创建持卡人
                </Button>
              </>
            )}
          </Form>
        </Spin>
      </Modal>

      {/* ── 批量导入弹窗 ── */}
      <Modal title="批量导入持卡人" open={batchModal} onCancel={() => setBatchModal(false)} footer={null} width={900} destroyOnClose>
        {/* 批量渠道选择 */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ marginRight: 8 }}>发卡渠道：</span>
          <Select value={batchChannel} onChange={v => { setBatchChannel(v); setValidateResult(null); setBatchResult(null); setBatchRaw('') }} style={{ width: 120 }}>
            {channels.filter(c => c !== 'DOGPAY').map(c => <Option key={c} value={c}>{c}</Option>)}
          </Select>
          <Button type="link" icon={<DownloadOutlined />} onClick={() => window.open(downloadCardholderTemplate(batchChannel))} style={{ marginLeft: 12 }}>
            下载{batchChannel}模板
          </Button>
        </div>

        {!validateResult && !batchResult && (
          <>
            <Alert message={`支持 JSON 数组或 CSV 格式，最多 100 条。已选渠道：${batchChannel}，请使用对应渠道的模板。`} type="info" style={{ marginBottom: 16 }} />
            <input
              type="file" accept=".csv,.txt" ref={fileInputRef}
              style={{ marginBottom: 12 }}
              onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]) }}
            />
            <Input.TextArea rows={8} placeholder={`选择 CSV 文件上传，或直接粘贴数据\nGEO 示例: firstName,lastName,email,...\nUQPAY 示例: firstName,lastName,email,phone,countryCode,...`}
              value={batchRaw} onChange={e => setBatchRaw(e.target.value)} />
            <Button type="primary" onClick={handleBatchValidate} style={{ marginTop: 12 }}>预校验</Button>
          </>
        )}

        {validateResult && !batchResult && (
          <>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}><Card><Statistic title="总计" value={validateResult.total} /></Card></Col>
              <Col span={8}><Card><Statistic title="有效" value={validateResult.valid} valueStyle={{ color: '#52c41a' }} /></Card></Col>
              <Col span={8}><Card><Statistic title="无效" value={validateResult.invalid} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
            </Row>
            {validateResult.rows?.filter((r: any) => !r.valid).map((r: any, i: number) => (
              <Alert key={i} type="error" showIcon message={`第 ${r.row} 行: ${r.errors.join('; ')}`} style={{ marginBottom: 4 }} />
            ))}
            <Space style={{ marginTop: 12 }}>
              <Button type="primary" loading={batchCreating} onClick={handleBatchCreate} disabled={validateResult.valid === 0}>
                确认导入 ({validateResult.valid} 条)
              </Button>
              <Button onClick={() => { setValidateResult(null); setBatchRaw('') }}>重新上传</Button>
            </Space>
          </>
        )}

        {batchResult && (
          <>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={6}><Card><Statistic title="总计" value={batchResult.total} /></Card></Col>
              <Col span={6}><Card><Statistic title="成功" value={batchResult.success} valueStyle={{ color: '#52c41a' }} /></Card></Col>
              <Col span={6}><Card><Statistic title="失败" value={batchResult.failed} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
            </Row>
            {batchResult.results?.filter((r: any) => !r.success).map((r: any, i: number) => (
              <Alert key={i} type="error" showIcon message={`第 ${r.row} 行: ${r.error}`} style={{ marginBottom: 4 }} />
            ))}
            <Button style={{ marginTop: 12 }} onClick={() => { setBatchModal(false); setBatchResult(null); setValidateResult(null); setBatchRaw('') }}>完成</Button>
          </>
        )}
      </Modal>

      {/* ── 详情弹窗 ── */}
      <Modal title="持卡人详情" open={detailModal} onCancel={() => setDetailModal(false)} footer={null}>
        {detailData && (
          <div>
            <p><strong>ID:</strong> {detailData.id}</p>
            <p><strong>渠道:</strong> {detailData.channel_code}</p>
            <p><strong>外部ID:</strong> {detailData.external_id || '-'}</p>
            <p><strong>姓名:</strong> {detailData.first_name} {detailData.last_name}</p>
            <p><strong>邮箱:</strong> {detailData.email_masked}</p>
            <p><strong>手机:</strong> {detailData.phone_masked}</p>
            <p><strong>国家:</strong> {detailData.country_code}</p>
            <p><strong>详细地址:</strong> {detailData.address_line1 || '-'}</p>
            <p><strong>城市:</strong> {detailData.city || '-'}</p>
            <p><strong>州/省:</strong> {detailData.state || '-'}</p>
            <p><strong>状态:</strong> <Tag color={detailData.status === 'ACTIVE' ? 'green' : detailData.status === 'FAILED' ? 'red' : 'blue'}>{detailData.status}</Tag></p>
            <p><strong>KYC:</strong> <Tag color={detailData.kyc_status === 'APPROVED' ? 'green' : detailData.kyc_status === 'REJECTED' ? 'red' : 'blue'}>{detailData.kyc_status || '-'}</Tag></p>
            <p><strong>创建时间:</strong> {detailData.created_at ? new Date(detailData.created_at).toLocaleString('zh-CN') : '-'}</p>
            {detailData.error_message && <p><strong>错误信息:</strong><span style={{ color: '#ff4d4f' }}>{detailData.error_message}</span></p>}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default CardholderManagement
