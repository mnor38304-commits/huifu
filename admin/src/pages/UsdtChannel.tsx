import { useState, useEffect } from 'react'
import { Card, Form, Input, Select, Button, Alert, Row, Col, Tag, Divider, message } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { getChannels, updateChannel, createChannel } from '../api'

const { Option } = Select

export default function UsdtChannel() {
  const [coinpalRecord, setCoinpalRecord] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => { loadCoinpal() }, [])

  const loadCoinpal = async () => {
    setLoading(true)
    try {
      const r: any = await getChannels()
      if (r.code === 0) {
        const cp = (r.data || []).find((ch: any) => ch.channel_code?.toUpperCase() === 'COINPAL')
        setCoinpalRecord(cp || null)
        if (cp) {
          form.setFieldsValue({
            channelName: cp.channel_name,
            apiBaseUrl: cp.api_base_url,
            status: cp.status,
          })
        } else {
          form.setFieldsValue({ channelName: 'CoinPal', apiBaseUrl: 'https://api.coinpal.io', status: 1 })
        }
      }
    } finally { setLoading(false) }
  }

  const onSave = async (values: any) => {
    setSaving(true)
    try {
      const payload = { ...values, channelCode: 'COINPAL' }
      const r: any = coinpalRecord
        ? await updateChannel(coinpalRecord.id, payload)
        : await createChannel(payload)
      if (r.code === 0) {
        message.success('CoinPal 渠道配置已保存')
        loadCoinpal()
      } else {
        message.error(r.message || '保存失败')
      }
    } catch (e: any) {
      message.error(e.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="CoinPal 是 USDT 收款渠道"
        description={
          <span>
            用户充值 USDT 时，系统通过 CoinPal 生成收款地址并监听链上到账。<br />
            请在此填写 CoinPal 的 API 凭证，配置正确后启用，即可开始接收 USDT 充值。<br />
            <strong>发卡渠道（DogPay 等）</strong>请前往「卡片管理 → 渠道对接」进行配置。
          </span>
        }
      />

      <Card
        loading={loading}
        style={{ borderRadius: 8, maxWidth: 680 }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>💰</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>CoinPal 收款渠道配置</div>
              <div style={{ fontSize: 12, color: '#999', fontWeight: 400 }}>USDT 链上收款 · CoinPal API</div>
            </div>
          </div>
        }
        extra={
          coinpalRecord
            ? <Tag color={coinpalRecord.status === 1 ? 'green' : 'default'} style={{ fontSize: 13 }}>
                {coinpalRecord.status === 1 ? '✅ 已启用' : '⏸ 已禁用'}
              </Tag>
            : <Tag color="orange" style={{ fontSize: 13 }}>⚠️ 未配置</Tag>
        }
      >
        <Form form={form} layout="vertical" onFinish={onSave}>
          <Divider orientation="left" plain style={{ color: '#666' }}>基本信息</Divider>
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item name="channelName" label="渠道名称" rules={[{ required: true, message: '请输入渠道名称' }]}>
                <Input placeholder="CoinPal" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="status" label="状态" initialValue={1}>
                <Select>
                  <Option value={1}>启用</Option>
                  <Option value={0}>禁用</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="apiBaseUrl" label="API 基础地址">
            <Input placeholder="https://api.coinpal.io" />
          </Form.Item>

          <Divider orientation="left" plain style={{ color: '#666' }}>API 凭证</Divider>
          <Form.Item
            name="apiKey"
            label="API Key"
            extra={coinpalRecord ? '已保存，留空则不修改' : ''}
          >
            <Input.Password
              placeholder={coinpalRecord ? '留空则不修改' : '请输入 CoinPal API Key'}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item
            name="apiSecret"
            label="API Secret"
            extra={coinpalRecord ? '已保存，留空则不修改' : ''}
          >
            <Input.Password
              placeholder={coinpalRecord ? '留空则不修改' : '请输入 CoinPal API Secret'}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item
            name="webhookSecret"
            label="Webhook 验签密钥"
            extra="用于验证 CoinPal 回调通知的真实性"
          >
            <Input.Password
              placeholder={coinpalRecord ? '留空则不修改' : '请输入 Webhook 验签密钥'}
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item style={{ marginTop: 16 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
              size="large"
            >
              {coinpalRecord ? '保存配置' : '创建并启用'}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
