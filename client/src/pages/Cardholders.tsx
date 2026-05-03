import { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, Select, Space, message, Spin, Row, Col, Alert, Tag } from 'antd'
import { PlusOutlined, UserOutlined, EyeOutlined } from '@ant-design/icons'
import {
  getMyCardholderProfiles, createMyCardholder, syncMyCardholder, updateCardholderEmail
} from '../services/api'

const { Option } = Select

const Cardholders: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState<any[]>([])

  // 创建弹窗
  const [createVisible, setCreateVisible] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => { loadList() }, [])

  const loadList = async () => {
    setLoading(true)
    try {
      const res = await getMyCardholderProfiles()
      if (res.code === 0) setList(res.data || [])
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  const openCreate = () => {
    form.resetFields()
    form.setFieldsValue({ countryCode: 'USA' })
    setCreateVisible(true)
  }

  const handleCreate = async (values: any) => {
    setCreating(true)
    try {
      const res = await createMyCardholder(values)
      if (res.code === 0) {
        message.success('持卡人创建成功')
        setCreateVisible(false)
        loadList()
      } else {
        message.error(res.message)
      }
    } catch {
      message.error('创建持卡人失败')
    } finally {
      setCreating(false)
    }
  }

  const [detailVisible, setDetailVisible] = useState(false)
  const [detailData, setDetailData] = useState<any>(null)
  const [emailEditValue, setEmailEditValue] = useState('')
  const [emailEditLoading, setEmailEditLoading] = useState(false)

  const openDetail = (row: any) => {
    setDetailData(row)
    setEmailEditValue('')
    setDetailVisible(true)
  }

  const handleEmailUpdate = async () => {
    if (!detailData || !emailEditValue) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEditValue)) { message.warning('邮箱格式不正确'); return }
    setEmailEditLoading(true)
    try {
      const res = await updateCardholderEmail(detailData.id, emailEditValue.trim())
      if (res.code === 0) {
        message.success('邮箱修改成功')
        setDetailVisible(false)
        loadList()
      } else {
        message.error(res.message)
      }
    } catch {
      message.error('修改失败')
    } finally {
      setEmailEditLoading(false)
    }
  }

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '邮箱', dataIndex: 'emailMasked', key: 'emailMasked' },
    { title: '手机', dataIndex: 'phoneMasked', key: 'phoneMasked' },
    { title: '国家', dataIndex: 'countryCode', key: 'countryCode', width: 80 },
    { title: '城市', dataIndex: 'city', key: 'city' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: string) => (
      <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '正常' : '停用'}</Tag>
    )},
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, r: any) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r)}>查看</Button>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2>持卡人管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>创建持卡人</Button>
      </div>

      <Table columns={columns} dataSource={list} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />

      {/* ── 创建持卡人弹窗 ── */}
      <Modal title="创建持卡人" open={createVisible} onCancel={() => setCreateVisible(false)} footer={null} width={650} destroyOnClose>
        <Spin spinning={creating}>
          <Form form={form} layout="vertical" onFinish={handleCreate}>
            <Alert type="info" showIcon message="基础身份信息" style={{ marginBottom: 16 }} />
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="firstName" label="名 (First Name)" rules={[{ required: true, message: '必填' }, { pattern: /^[a-zA-Z\s\-']+$/, message: '只能包含字母' }]}>
                  <Input placeholder="John" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="lastName" label="姓 (Last Name)" rules={[{ required: true, message: '必填' }, { pattern: /^[a-zA-Z\s\-']+$/, message: '只能包含字母' }]}>
                  <Input placeholder="Doe" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '必填' }, { type: 'email', message: '邮箱格式不正确' }]}>
              <Input placeholder="john@example.com" type="email" />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '必填' }, { pattern: /^[\d\s\-\(\)]{6,20}$/, message: '手机号格式不正确' }]}>
                  <Input placeholder="1234567890" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="birthDate" label="出生日期" rules={[{ required: true, message: '必填' }, { pattern: /^\d{4}-\d{2}-\d{2}$/, message: '格式必须为 YYYY-MM-DD' }]}>
                  <Input placeholder="1990-01-01" />
                </Form.Item>
              </Col>
            </Row>

            <Alert type="info" showIcon message="地址资料" style={{ marginBottom: 16, marginTop: 8 }} />
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="countryCode" label="国家" rules={[{ required: true, message: '请选择国家' }]} initialValue="USA">
                  <Select>
                    <Option value="USA">USA</Option>
                    <Option value="SG">SG</Option>
                    <Option value="HK">HK</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="mobilePrefix" label="手机区号">
                  <Input placeholder="1" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="postalCode" label="邮编" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="90001" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="state" label="州/省" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="CA" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="city" label="城市" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="Los Angeles" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={16}>
                <Form.Item name="addressLine1" label="地址" rules={[{ required: true, message: '必填' }]}>
                  <Input placeholder="123 Main Street" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="addressLine2" label="地址补充（可选）">
                  <Input placeholder="Apt 1B" />
                </Form.Item>
              </Col>
            </Row>

            <Button type="primary" htmlType="submit" loading={creating} block style={{ marginTop: 16 }}>
              创建持卡人
            </Button>
          </Form>
        </Spin>
      </Modal>

      {/* ── 持卡人详情弹窗 ── */}
      <Modal title="持卡人详情" open={detailVisible} onCancel={() => setDetailVisible(false)} footer={null} destroyOnClose>
        {detailData && (
          <div>
            <p><strong>姓名：</strong>{detailData.name}</p>
            <p><strong>邮箱：</strong>{detailData.emailMasked}
              <Button type="link" size="small" onClick={() => {
                setEmailEditValue('')
                message.info('请输入新邮箱后点击保存')
              }}>修改</Button>
            </p>
            <div style={{ marginTop: 8 }}>
              <Input placeholder="输入新邮箱" value={emailEditValue} onChange={e => setEmailEditValue(e.target.value)}
                style={{ width: 300 }} type="email" />
              <Button type="primary" size="small" style={{ marginLeft: 8 }}
                loading={emailEditLoading} onClick={handleEmailUpdate}>保存</Button>
            </div>
            <p style={{ marginTop: 16 }}><strong>手机：</strong>{detailData.phoneMasked}</p>
            <p><strong>国家：</strong>{detailData.countryCode} / <strong>城市：</strong>{detailData.city}</p>
            <Tag color="green">持卡人资料：已完成</Tag>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default Cardholders
