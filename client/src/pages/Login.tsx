import { useState } from 'react'
import { Form, Input, Button, Card, message, Tabs, Divider } from 'antd'
import { UserOutlined, LockOutlined, MobileOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { login, getUserInfo, sendSms, sendEmail } from '../services/api'

interface LoginProps {
  onLogin: (user: any) => void
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const navigate = useNavigate()
  const [form] = Form.useForm()

  const handleSendCode = async (type: 'phone' | 'email') => {
    const value = form.getFieldValue(type === 'phone' ? 'phone' : 'email')
    if (!value) {
      message.error('请输入手机号/邮箱')
      return
    }
    setSendingCode(true)
    try {
      if (type === 'phone') {
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

  const onFinish = async (values: { account: string; password: string }) => {
    setLoading(true)
    try {
      const res = await login(values.account, values.password)
      if (res.code === 0) {
        // Token 已由后端写入 httpOnly Cookie，无需前端存储
        message.success('登录成功')
        // 登录成功后重新拉取用户信息（Cookie 会自动携带）
        const meRes = await getUserInfo()
        onLogin(meRes.code === 0 ? meRes.data : res.data)
        navigate('/')
      } else {
        message.error(res.message)
      }
    } catch (error: any) {
      message.error(error.response?.data?.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
      <Card style={{ width: 400, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>VCC 商户端</h1>
          <p style={{ color: '#666' }}>虚拟信用卡管理平台</p>
        </div>
        
        <Form form={form} name="login" onFinish={onFinish} size="large">
          <Form.Item name="account" rules={[{ required: true, message: '请输入手机号或邮箱' }]}>
            <Input prefix={<UserOutlined />} placeholder="手机号 / 邮箱" />
          </Form.Item>
          
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <a
                onClick={() => navigate('/forgot-password')}
                style={{ fontSize: 13, color: '#1677ff' }}
              >
                忘记密码？
              </a>
            </div>
          </Form.Item>
          
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
        
        <Divider plain>
          <span style={{ color: '#999' }}>其他登录方式</span>
        </Divider>
        
        <div style={{ textAlign: 'center' }}>
          <span style={{ color: '#666' }}>还没有账号？</span>
          <a onClick={() => navigate('/register')}>立即注册</a>
        </div>
      </Card>
    </div>
  )
}

export default Login