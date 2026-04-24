import { useState } from 'react'
import { Form, Input, Button, Card, message, Tabs, Result } from 'antd'
import { LockOutlined, MobileOutlined, MailOutlined, SafetyOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { register, sendSms, sendEmail } from '../services/api'

const Register: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [activeTab, setActiveTab] = useState('phone')
  const [registered, setRegistered] = useState(false)
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
        message.success('注册成功！')
        setRegistered(true)
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
        {registered ? (
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            title="注册成功！"
            subTitle={
              <div>
                <p style={{ margin: '8px 0', color: '#666' }}>
                  欢迎加入 VCC 虚拟卡管理平台，请尽快完成实名认证以解锁全部功能。
                </p>
                <div style={{
                  background: '#fff7e6',
                  border: '1px solid #ffd591',
                  borderRadius: 8,
                  padding: '12px 16px',
                  marginTop: 8,
                  marginBottom: 8,
                }}>
                  <strong style={{ color: '#fa8c16' }}>实名认证说明</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#666', fontSize: 13 }}>
                    <li>登录后前往「设置 → 实名认证」提交资料</li>
                    <li>需提供有效证件信息进行身份核验</li>
                    <li>认证通过后方可开通虚拟卡服务</li>
                  </ul>
                </div>
              </div>
            }
            extra={[
              <Button type="primary" key="login" size="large" onClick={() => navigate('/login')} block>
                立即登录
              </Button>,
            ]}
          />
        ) : (
        <>

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
        </>
        )}
      </Card>
    </div>
  )
}

export default Register
