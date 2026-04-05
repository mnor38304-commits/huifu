import { useState } from 'react'
import { Form, Input, Button, Card, message, Tabs } from 'antd'
import { LockOutlined, MobileOutlined, MailOutlined, SafetyOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { register, sendSms, sendEmail } from '../services/api'

const Register: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [activeTab, setActiveTab] = useState('phone')
  const navigate = useNavigate()
  const [form] = Form.useForm()

  const handleSendCode = async () => {
    const fieldName = activeTab === 'phone' ? 'phone' : 'email'
    const value = form.getFieldValue(fieldName)

    if (!value) {
      message.error(`请输入${activeTab === 'phone' ? '手机号' : '邮箱'}`)
      return
    }

    setSendingCode(true)
    try {
      if (activeTab === 'phone') {
        await sendSms(value)
      } else {
        await sendEmail(value)
      }
      message.success('验证码已发送')
      setCountdown(60)
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (error: any) {
      message.error(error.response?.data?.message || '发送失败')
    } finally {
      setSendingCode(false)
    }
  }

  const onFinish = async (values: any) => {
    setLoading(true)
    try {
      const data = activeTab === 'phone'
        ? { phone: values.phone, code: values.code, password: values.password }
        : { email: values.email, code: values.code, password: values.password }

      const res = await register(data)
      if (res.code === 0) {
        message.success('注册成功，请登录')
        navigate('/login')
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '注册失败')
    } finally {
      setLoading(false)
    }
  }

  const tabItems = [
    {
      key: 'phone',
      label: <span><MobileOutlined /> 手机号注册</span>
    },
    {
      key: 'email',
      label: <span><MailOutlined /> 邮箱注册</span>
    }
  ]

  const handleTabChange = (key: string) => {
    setActiveTab(key)
    form.setFieldsValue({
      code: undefined,
      phone: key === 'phone' ? form.getFieldValue('phone') : undefined,
      email: key === 'email' ? form.getFieldValue('email') : undefined,
    })
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
      <Card style={{ width: 400, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>注册 VCC 账户</h1>
          <p style={{ color: '#666' }}>创建您的虚拟卡管理账户</p>
        </div>

        <Form form={form} onFinish={onFinish} size="large">
          <Tabs activeKey={activeTab} onChange={handleTabChange} items={tabItems} />

          {activeTab === 'phone' ? (
            <>
              <Form.Item name="phone" rules={[{ required: true, message: '请输入手机号' }]}>
                <Input prefix={<MobileOutlined />} placeholder="手机号" />
              </Form.Item>
              <Form.Item>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Form.Item name="code" rules={[{ required: true, message: '请输入验证码' }]} style={{ flex: 1, marginBottom: 0 }}>
                    <Input prefix={<SafetyOutlined />} placeholder="验证码" />
                  </Form.Item>
                  <Button onClick={handleSendCode} disabled={countdown > 0} loading={sendingCode}>
                    {countdown > 0 ? `${countdown}s` : '获取验证码'}
                  </Button>
                </div>
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item name="email" rules={[{ required: true, type: 'email', message: '请输入邮箱' }]}>
                <Input prefix={<MailOutlined />} placeholder="邮箱" />
              </Form.Item>
              <Form.Item>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Form.Item name="code" rules={[{ required: true, message: '请输入验证码' }]} style={{ flex: 1, marginBottom: 0 }}>
                    <Input prefix={<SafetyOutlined />} placeholder="验证码" />
                  </Form.Item>
                  <Button onClick={handleSendCode} disabled={countdown > 0} loading={sendingCode}>
                    {countdown > 0 ? `${countdown}s` : '获取验证码'}
                  </Button>
                </div>
              </Form.Item>
            </>
          )}

          <Form.Item name="password" rules={[{ required: true, min: 6, message: '密码至少6位' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="设置密码（至少6位）" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              注册
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <span style={{ color: '#666' }}>已有账号？</span>
          <a onClick={() => navigate('/login')}>立即登录</a>
        </div>
      </Card>
    </div>
  )
}

export default Register
