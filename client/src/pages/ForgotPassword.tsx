import { useState } from 'react'
import { Form, Input, Button, Card, message, Steps } from 'antd'
import { MailOutlined, LockOutlined, SafetyOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { sendSms, sendEmail, resetPassword } from '../services/api'

const ForgotPassword: React.FC = () => {
  const [current, setCurrent] = useState(0)   // 0=填账号 1=填验证码+新密码
  const [account, setAccount] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [form1] = Form.useForm()
  const [form2] = Form.useForm()
  const navigate = useNavigate()

  // 判断是手机号还是邮箱
  const isPhone = (val: string) => /^[0-9]{5,15}$/.test(val)

  const handleSendCode = async () => {
    const acc = form1.getFieldValue('account')?.trim()
    if (!acc) {
      message.error('请输入手机号或邮箱')
      return
    }
    setSendingCode(true)
    try {
      if (isPhone(acc)) {
        await sendSms(acc)
      } else {
        await sendEmail(acc)
      }
      setAccount(acc)
      message.success('验证码已发送')
      setCurrent(1)
      setCountdown(60)
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0 }
          return prev - 1
        })
      }, 1000)
    } catch (err: any) {
      message.error(err.response?.data?.message || '发送失败，请稍后重试')
    } finally {
      setSendingCode(false)
    }
  }

  const handleResend = async () => {
    if (countdown > 0) return
    setSendingCode(true)
    try {
      if (isPhone(account)) {
        await sendSms(account)
      } else {
        await sendEmail(account)
      }
      message.success('验证码已重新发送')
      setCountdown(60)
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0 }
          return prev - 1
        })
      }, 1000)
    } catch (err: any) {
      message.error(err.response?.data?.message || '发送失败')
    } finally {
      setSendingCode(false)
    }
  }

  const handleReset = async (values: { code: string; newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    try {
      const res: any = await resetPassword(account, values.code, values.newPassword)
      if (res.code === 0) {
        message.success('密码重置成功，请重新登录')
        setTimeout(() => navigate('/login'), 1500)
      } else {
        message.error(res.message || '重置失败')
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || '重置失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
      <Card style={{ width: 420, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h2 style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 4 }}>找回密码</h2>
          <p style={{ color: '#999', fontSize: 13 }}>通过手机号或邮箱验证后重置密码</p>
        </div>

        <Steps
          current={current}
          size="small"
          style={{ marginBottom: 28 }}
          items={[
            { title: '验证账号' },
            { title: '重置密码' },
          ]}
        />

        {/* Step 0：输入账号并发验证码 */}
        {current === 0 && (
          <Form form={form1} layout="vertical" size="large">
            <Form.Item
              name="account"
              label="手机号 / 邮箱"
              rules={[{ required: true, message: '请输入手机号或邮箱' }]}
            >
              <Input prefix={<MailOutlined />} placeholder="请输入注册时使用的手机号或邮箱" />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                block
                loading={sendingCode}
                onClick={handleSendCode}
              >
                发送验证码
              </Button>
            </Form.Item>
            <div style={{ textAlign: 'center' }}>
              <a onClick={() => navigate('/login')} style={{ color: '#999', fontSize: 13 }}>
                ← 返回登录
              </a>
            </div>
          </Form>
        )}

        {/* Step 1：填验证码 + 新密码 */}
        {current === 1 && (
          <Form form={form2} layout="vertical" size="large" onFinish={handleReset}>
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#52c41a' }}>
              验证码已发送至：<strong>{account}</strong>
            </div>

            <Form.Item
              name="code"
              label="验证码"
              rules={[{ required: true, message: '请输入验证码' }, { len: 6, message: '验证码为6位数字' }]}
            >
              <Input
                prefix={<SafetyOutlined />}
                placeholder="请输入6位验证码"
                maxLength={6}
                suffix={
                  <Button
                    type="link"
                    size="small"
                    disabled={countdown > 0 || sendingCode}
                    onClick={handleResend}
                    style={{ padding: 0 }}
                  >
                    {countdown > 0 ? `${countdown}s 后重发` : '重新发送'}
                  </Button>
                }
              />
            </Form.Item>

            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '密码至少6位' }
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入新密码（至少6位）" />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve()
                    }
                    return Promise.reject(new Error('两次密码不一致'))
                  },
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请再次输入新密码" />
            </Form.Item>

            <Form.Item>
              <Button type="primary" htmlType="submit" block loading={submitting}>
                重置密码
              </Button>
            </Form.Item>

            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <a
                onClick={() => { setCurrent(0); form2.resetFields() }}
                style={{ color: '#999', fontSize: 13, marginRight: 16 }}
              >
                ← 重新输入账号
              </a>
              <a onClick={() => navigate('/login')} style={{ color: '#999', fontSize: 13 }}>
                返回登录
              </a>
            </div>
          </Form>
        )}
      </Card>
    </div>
  )
}

export default ForgotPassword
