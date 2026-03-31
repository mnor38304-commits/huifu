import { useState, useEffect } from 'react'
import { Card, Descriptions, Button, Modal, Form, Input, Select, message, Spin, Tag, List } from 'antd'
import { getUserInfo, getKycStatus, submitKyc } from '../services/api'

const { Option } = Select

const Settings: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [kycStatus, setKycStatus] = useState<any>({})
  const [kycModalVisible, setKycModalVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [userRes, kycRes] = await Promise.all([
        getUserInfo(),
        getKycStatus()
      ])
      if (userRes.code === 0) setUser(userRes.data)
      if (kycRes.code === 0) setKycStatus(kycRes.data || {})
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleKycSubmit = async (values: any) => {
    setSubmitting(true)
    try {
      const res = await submitKyc(values)
      if (res.code === 0) {
        message.success('认证资料已提交')
        setKycModalVisible(false)
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
              {kycStatusMap[kycStatus.kycStatus]?.text}
            </Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card 
        title="实名认证信息" 
        extra={
          kycStatus.kycStatus !== 2 && (
            <Button type="primary" onClick={() => setKycModalVisible(true)}>
              {kycStatus.kycStatus === 0 ? '去认证' : '重新认证'}
            </Button>
          )
        }
      >
        {kycStatus.record ? (
          <Descriptions column={2}>
            <Descriptions.Item label="主体类型">{subjectTypeMap[kycStatus.record.subject_type]}</Descriptions.Item>
            <Descriptions.Item label="姓名">{kycStatus.record.real_name}</Descriptions.Item>
            <Descriptions.Item label="证件类型">{idTypeMap[kycStatus.record.id_type]}</Descriptions.Item>
            <Descriptions.Item label="认证状态">
              <Tag color={kycStatusMap[kycStatus.record.status]?.color}>
                {kycStatusMap[kycStatus.record.status]?.text}
              </Tag>
            </Descriptions.Item>
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

      <Modal
        title="实名认证"
        open={kycModalVisible}
        onCancel={() => setKycModalVisible(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={handleKycSubmit}>
          <Form.Item name="subjectType" label="认证主体" initialValue={1}>
            <Select>
              <Option value={1}>个人</Option>
              <Option value={2}>企业</Option>
            </Select>
          </Form.Item>
          
          <Form.Item name="realName" label="真实姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入真实姓名" />
          </Form.Item>
          
          <Form.Item name="idNumber" label="证件号码" rules={[{ required: true, message: '请输入证件号码' }]}>
            <Input placeholder="请输入证件号码" />
          </Form.Item>
          
          <Form.Item name="idType" label="证件类型" initialValue={1}>
            <Select>
              <Option value={1}>身份证</Option>
              <Option value={2}>护照</Option>
              <Option value={3}>营业执照</Option>
            </Select>
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