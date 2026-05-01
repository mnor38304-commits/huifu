import { useState, useEffect, useRef } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Upload, Alert, Row, Col, Statistic, Spin } from 'antd'
import { PlusOutlined, DownloadOutlined, UploadOutlined, EyeOutlined, DeleteOutlined } from '@ant-design/icons'
import { getCardholders, createCardholder, batchValidateCardholders, batchCreateCardholders, downloadCardholderTemplate, getCardholderChannelList } from '../api'
import type { ColumnsType } from 'antd/es/table'

const CardholderManagement: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [filters, setFilters] = useState<any>({ channel: 'DOGPAY' })

  // 单个添加
  const [addModal, setAddModal] = useState(false)
  const [addForm] = Form.useForm()
  const [addLoading, setAddLoading] = useState(false)

  // 批量添加
  const [batchModal, setBatchModal] = useState(false)
  const [batchData, setBatchData] = useState<any[]>([])
  const [batchRaw, setBatchRaw] = useState('')
  const [validateResult, setValidateResult] = useState<any>(null)
  const [batchCreating, setBatchCreating] = useState(false)
  const [batchResult, setBatchResult] = useState<any>(null)

  // 详情
  const [detailModal, setDetailModal] = useState(false)
  const [detailData, setDetailData] = useState<any>(null)

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

  // 单个添加
  const handleAdd = async (values: any) => {
    setAddLoading(true)
    try {
      const r: any = await createCardholder(values)
      if (r.code === 0) {
        message.success('创建成功')
        setAddModal(false)
        addForm.resetFields()
        loadList()
      } else message.error(r.message)
    } catch { message.error('创建失败') }
    finally { setAddLoading(false) }
  }

  // 批量预校验
  const handleBatchValidate = async () => {
    try {
      let rows: any[]
      try {
        rows = JSON.parse(batchRaw)
      } catch {
        // Try CSV
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
      const r: any = await batchValidateCardholders({ rows, channelCode: 'DOGPAY' })
      if (r.code === 0) {
        setValidateResult(r.data)
        setBatchData(rows)
      } else message.error(r.message)
    } catch { message.error('解析失败，请检查格式') }
  }

  // 批量创建
  const handleBatchCreate = async () => {
    if (!batchData.length) return
    setBatchCreating(true)
    try {
      const r: any = await batchCreateCardholders({ rows: batchData, channelCode: 'DOGPAY' })
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

  const columns: ColumnsType<any> = [
    { title: 'ID', dataIndex: 'id', width: 50 },
    { title: '渠道', dataIndex: 'channel_code', width: 70 },
    { title: '外部ID', dataIndex: 'external_id', width: 120, render: (v: string) => v ? v.substring(0, 12) + '...' : '-' },
    { title: '姓名', dataIndex: 'first_name', width: 100, render: (_: any, r: any) => `${r.first_name || ''} ${r.last_name || ''}` },
    { title: '邮箱', dataIndex: 'email_masked', width: 140 },
    { title: '手机', dataIndex: 'phone_masked', width: 100 },
    { title: '国家', dataIndex: 'country_code', width: 50 },
    { title: '证件号', dataIndex: 'id_number_masked', width: 120 },
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
          <Select value="DOGPAY" style={{ width: 120 }} disabled>
            <Select.Option value="DOGPAY">DogPay</Select.Option>
          </Select>
          <Select
            allowClear placeholder="状态" style={{ width: 120 }}
            onChange={v => setFilters(f => ({ ...f, status: v || undefined }))}
          >
            <Select.Option value="PENDING">PENDING</Select.Option>
            <Select.Option value="ACTIVE">ACTIVE</Select.Option>
            <Select.Option value="FAILED">FAILED</Select.Option>
          </Select>
          <Select
            allowClear placeholder="KYC" style={{ width: 120 }}
            onChange={v => setFilters(f => ({ ...f, kycStatus: v || undefined }))}
          >
            <Select.Option value="PENDING">PENDING</Select.Option>
            <Select.Option value="APPROVED">APPROVED</Select.Option>
            <Select.Option value="REJECTED">REJECTED</Select.Option>
          </Select>
          <Input.Search
            placeholder="关键字搜索" style={{ width: 200 }}
            onSearch={v => setFilters(f => ({ ...f, keyword: v || undefined }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setAddModal(true); addForm.resetFields() }}>
            新增持卡人
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => { setBatchModal(true); setBatchResult(null); setValidateResult(null); setBatchRaw('') }}>
            批量导入
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => window.open(downloadCardholderTemplate('DOGPAY'))}>
            下载模板
          </Button>
        </Space>
      </Card>

      <Table
        dataSource={list}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ current: page, total, pageSize, onChange: setPage }}
        scroll={{ x: 1000 }}
      />

      {/* 单个添加弹窗 */}
      <Modal title="新增持卡人" open={addModal} onCancel={() => setAddModal(false)} footer={null}>
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="firstName" label="名 (firstName)" rules={[{ required: true, message: '必填' }, { pattern: /^[a-zA-Z\s\-']+$/, message: '只能包含字母' }]}>
            <Input placeholder="John" />
          </Form.Item>
          <Form.Item name="lastName" label="姓 (lastName)" rules={[{ required: true, message: '必填' }, { pattern: /^[a-zA-Z\s\-']+$/, message: '只能包含字母' }]}>
            <Input placeholder="Doe" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '必填' }, { type: 'email', message: '邮箱格式不正确' }]}>
            <Input placeholder="john@example.com" />
          </Form.Item>
          <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '必填' }, { pattern: /^[\d\s\-\+\(\)]{6,20}$/, message: '手机号格式不正确' }]}>
            <Input placeholder="1234567890" />
          </Form.Item>
          <Form.Item name="countryCode" label="国家码" initialValue="US" rules={[{ pattern: /^[A-Z]{2}$/, message: '必须为 2 位大写国家码' }]}>
            <Input placeholder="US" maxLength={2} style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="idType" label="证件类型" initialValue={0}>
            <Select>
              <Select.Option value={0}>身份证</Select.Option>
              <Select.Option value={1}>护照</Select.Option>
              <Select.Option value={2}>驾照</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="idNumber" label="证件号">
            <Input.Password placeholder="选填" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={addLoading} block>创建持卡人</Button>
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量导入弹窗 */}
      <Modal title="批量导入持卡人" open={batchModal} onCancel={() => setBatchModal(false)} footer={null} width={800}>
        {!validateResult && !batchResult && (
          <>
            <Alert message="支持 JSON 数组或 CSV 格式，最多 100 条" type="info" style={{ marginBottom: 16 }} />
            <Input.TextArea rows={8} placeholder={`[{"firstName":"John","lastName":"Doe","email":"john@example.com","phone":"1234567890","countryCode":"US","idType":1,"idNumber":"P123456789"}]`}
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

      {/* 详情弹窗 */}
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
            <p><strong>证件号:</strong> {detailData.id_number_masked || '-'}</p>
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
