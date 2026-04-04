import { useState, useEffect } from 'react'
import dayjs from 'dayjs'
import { Card, Descriptions, Button, Modal, Form, Input, Select, message, Spin, Tag, List, DatePicker, Alert, Checkbox } from 'antd'
import { getUserInfo, getKycStatus, submitKyc } from '../services/api'

const { Option } = Select

const Settings: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [kycStatus, setKycStatus] = useState<any>({})
  const [kycModalVisible, setKycModalVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  const subjectType = Form.useWatch('subjectType', form) || 1
  const currentIdType = Form.useWatch('idType', form) || 1

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [userRes, kycRes] = await Promise.all([getUserInfo(), getKycStatus()])
      if (userRes.code === 0) setUser(userRes.data)
      if (kycRes.code === 0) setKycStatus(kycRes.data || {})
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenKycModal = () => {
    const record = kycStatus.record
    form.setFieldsValue({
      subjectType: record?.subject_type || 1,
      realName: record?.real_name || '',
      idNumber: record?.id_number || '',
      idType: record?.id_type || 1,
      idExpireDate: record?.id_expire_date ? dayjs(record.id_expire_date) : undefined,
      idFrontUrl: record?.id_front_url || '',
      idBackUrl: record?.id_back_url || '',
      idHoldUrl: record?.id_hold_url || '',
      agreement: false,
    })
    setKycModalVisible(true)
  }

  const handleKycSubmit = async (values: any) => {
    setSubmitting(true)
    try {
      const payload = {
        ...values,
        idExpireDate: values.idExpireDate ? values.idExpireDate.format('YYYY-MM-DD') : null,
      }
      delete payload.agreement
      const res = await submitKyc(payload)
      if (res.code === 0) {
        message.success('认证资料已提交')
        setKycModalVisible(false)
        form.resetFields()
        loadData()
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const kycStatusMap: Record<number, { text: string; color: string }> = {
    0: { text: '未认证', color: 'default' },
    1: { text: '认证中', color: 'processing' },
    2: { text: '已认证', color: 'success' },
    3: { text: '认证失败', color: 'error' },
  }

  const subjectTypeMap: Record<number, string> = {
    1: '个人',
    2: '企业',
  }

  const idTypeMap: Record<number, string> = {
    1: '身份证',
    2: '护照',
    3: '营业执照',
  }

  const protocols = [
    { name: '虚拟卡服务协议', date: '2026-01-01' },
    { name: '用户注册协议', date: '2026-01-01' },
    { name: '隐私政策', date: '2026-01-01' },
    { name: '费率说明', date: '2026-01-01' },
  ]

  const canSubmitKyc = kycStatus.kycStatus === 0 || kycStatus.kycStatus === 3 || kycStatus.kycStatus === undefined
  const entityNameLabel = subjectType === 2 ? '企业名称' : '真实姓名'
  const entityNamePlaceholder = subjectType === 2 ? '请输入企业名称' : '请输入真实姓名'
  const numberLabel = subjectType === 2 ? '营业执照号' : '证件号码'
  const idTypeOptions = subjectType === 2
    ? [{ value: 3, label: '营业执照' }]
    : [{ value: 1, label: '身份证' }, { value: 2, label: '护照' }]

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>设置</h2>

      <Card title="用户信息" style={{ marginBottom: 16 }}>
        <Descriptions column={2}>
          <Descriptions.Item label="用户编号">{user?.user_no}</Descriptions.Item>
          <Descriptions.Item label="手机号">{user?.phone ? user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : '-'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{user?.email ? user.email.replace(/(\w{1,2})\w*(@\w+\.\w+)/, '$1***$2') : '-'}</Descriptions.Item>
          <Descriptions.Item label="实名状态">
            <Tag color={kycStatusMap[kycStatus.kycStatus]?.color}>
              {kycStatusMap[kycStatus.kycStatus]?.text || '未认证'}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        title="实名认证信息"
        extra={
          canSubmitKyc ? (
            <Button type="primary" onClick={handleOpenKycModal}>
              {kycStatus.kycStatus === 3 ? '重新认证' : '去认证'}
            </Button>
          ) : kycStatus.kycStatus === 1 ? (
            <Button disabled>审核中</Button>
          ) : null
        }
      >
        {kycStatus.record ? (
          <Descriptions column={2}>
            <Descriptions.Item label="主体类型">{subjectTypeMap[kycStatus.record.subject_type]}</Descriptions.Item>
            <Descriptions.Item label={kycStatus.record.subject_type === 2 ? '企业名称' : '姓名'}>{kycStatus.record.real_name}</Descriptions.Item>
            <Descriptions.Item label="证件类型">{idTypeMap[kycStatus.record.id_type]}</Descriptions.Item>
            <Descriptions.Item label="证件号码">{kycStatus.record.id_number ? `${String(kycStatus.record.id_number).slice(0, 4)}****${String(kycStatus.record.id_number).slice(-4)}` : '-'}</Descriptions.Item>
            <Descriptions.Item label="证件到期日">{kycStatus.record.id_expire_date || '-'}</Descriptions.Item>
            <Descriptions.Item label="认证状态">
              <Tag color={kycStatusMap[kycStatus.record.status]?.color}>
                {kycStatusMap[kycStatus.record.status]?.text || '未认证'}
              </Tag>
            </Descriptions.Item>
            {kycStatus.record.id_front_url && <Descriptions.Item label="证件正面" span={2}><a href={kycStatus.record.id_front_url} target="_blank" rel="noreferrer">查看证件正面</a></Descriptions.Item>}
            {kycStatus.record.id_back_url && <Descriptions.Item label="证件反面" span={2}><a href={kycStatus.record.id_back_url} target="_blank" rel="noreferrer">查看证件反面</a></Descriptions.Item>}
            {kycStatus.record.id_hold_url && <Descriptions.Item label="手持证件" span={2}><a href={kycStatus.record.id_hold_url} target="_blank" rel="noreferrer">查看手持证件</a></Descriptions.Item>}
            {kycStatus.record.reject_reason && (
              <Descriptions.Item label="拒绝原因" span={2}>
                <span style={{ color: '#ff4d4f' }}>{kycStatus.record.reject_reason}</span>
              </Descriptions.Item>
            )}
          </Descriptions>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            暂无认证信息，请先完成实名认证
          </div>
        )}
      </Card>

      <Card title="用户协议" style={{ marginBottom: 16 }}>
        <List
          size="small"
          dataSource={protocols}
          renderItem={item => (
            <List.Item>
              <div>{item.name}</div>
              <div>
                <span style={{ color: '#999', marginRight: 16 }}>{item.date}</span>
                <Button type="link" size="small">查看</Button>
              </div>
            </List.Item>
          )}
        />
      </Card>

      <Modal title="实名认证" open={kycModalVisible} onCancel={() => setKycModalVisible(false)} footer={null} width={640} destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message="请提交真实、清晰、可核验的资料链接。审核通过后将自动更新认证状态。" />
        <Form
          form={form}
          layout="vertical"
          onFinish={handleKycSubmit}
          initialValues={{ subjectType: 1, idType: 1 }}
          onValuesChange={(changed) => {
            if (changed.subjectType === 2) form.setFieldValue('idType', 3)
            if (changed.subjectType === 1 && currentIdType === 3) form.setFieldValue('idType', 1)
          }}
        >
          <Form.Item name="subjectType" label="认证主体" rules={[{ required: true, message: '请选择认证主体' }]}>
            <Select>
              <Option value={1}>个人</Option>
              <Option value={2}>企业</Option>
            </Select>
          </Form.Item>

          <Form.Item name="realName" label={entityNameLabel} rules={[{ required: true, message: `请输入${entityNameLabel}` }]}>
            <Input placeholder={entityNamePlaceholder} />
          </Form.Item>

          <Form.Item name="idType" label="证件类型" rules={[{ required: true, message: '请选择证件类型' }]}>
            <Select>
              {idTypeOptions.map((item) => <Option key={item.value} value={item.value}>{item.label}</Option>)}
            </Select>
          </Form.Item>

          <Form.Item name="idNumber" label={numberLabel} rules={[{ required: true, message: `请输入${numberLabel}` }]}>
            <Input placeholder={`请输入${numberLabel}`} />
          </Form.Item>

          <Form.Item name="idExpireDate" label="证件到期日" rules={[{ required: true, message: '请选择证件到期日' }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>

          <Form.Item name="idFrontUrl" label={subjectType === 2 ? '营业执照图片地址' : '证件正面图片地址'} rules={[{ required: true, message: '请填写图片地址' }, { type: 'url', message: '请输入有效链接' }]}>
            <Input placeholder="https://example.com/front.jpg" />
          </Form.Item>

          <Form.Item name="idBackUrl" label={subjectType === 2 ? '补充材料图片地址' : '证件反面图片地址'} rules={[{ required: true, message: '请填写图片地址' }, { type: 'url', message: '请输入有效链接' }]}>
            <Input placeholder="https://example.com/back.jpg" />
          </Form.Item>

          <Form.Item name="idHoldUrl" label={subjectType === 2 ? '法人/经办人资料图片地址' : '手持证件图片地址'} rules={[{ type: 'url', message: '请输入有效链接' }]}>
            <Input placeholder="可选，https://example.com/hold.jpg" />
          </Form.Item>

          <Form.Item name="agreement" valuePropName="checked" rules={[{ validator: async (_, value) => value ? Promise.resolve() : Promise.reject(new Error('请先确认提交资料真实有效')) }]}>
            <Checkbox>我确认提交资料真实、有效，并授权平台进行实名认证审核</Checkbox>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block>
              提交认证
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Settings
