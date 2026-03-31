import { useState, useEffect } from 'react'
import { Table, Button, Tag, Space, Card, Modal, Form, Input, Select, message } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { getNotices, createNotice, updateNotice, deleteNotice } from '../api'

const { Option } = Select

const typeMap: Record<string, { text: string; color: string }> = {
  system: { text: '系统公告', color: 'blue' }, feature: { text: '新功能', color: 'green' },
  notice: { text: '通知', color: 'orange' }, activity: { text: '活动', color: 'purple' }
}

export default function Notices() {
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editRecord, setEditRecord] = useState<any>(null)
  const [form] = Form.useForm()

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getNotices()
      if (r.code === 0) setList(r.data)
    } finally { setLoading(false) }
  }

  const openCreate = () => { setEditRecord(null); form.resetFields(); setModalVisible(true) }
  const openEdit = (r: any) => {
    setEditRecord(r)
    form.setFieldsValue({ title: r.title, content: r.content, type: r.type, status: r.status, top: r.top })
    setModalVisible(true)
  }

  const onSubmit = async (values: any) => {
    try {
      const r: any = editRecord ? await updateNotice(editRecord.id, values) : await createNotice(values)
      if (r.code === 0) { message.success(editRecord ? '更新成功' : '发布成功'); setModalVisible(false); load() }
      else message.error(r.message)
    } catch (e: any) { message.error('操作失败') }
  }

  const onDelete = async (id: number) => {
    const r: any = await deleteNotice(id)
    if (r.code === 0) { message.success('已下线'); load() }
  }

  const cols = [
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '类型', dataIndex: 'type', key: 'type', width: 100,
      render: (v: string) => <Tag color={typeMap[v]?.color}>{typeMap[v]?.text || v}</Tag> },
    { title: '置顶', dataIndex: 'top', key: 'top', width: 80,
      render: (v: number) => v ? <Tag color="red">置顶</Tag> : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: number) => <Tag color={v===1?'green':'default'}>{v===1?'已发布':'已下线'}</Tag> },
    { title: '发布时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v?.split('T')[0] },
    { title: '操作', key: 'action', width: 140,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(r)}><EditOutlined /> 编辑</Button>
          <Button type="link" size="small" danger onClick={() => onDelete(r.id)}><DeleteOutlined /> 下线</Button>
        </Space>
      )
    }
  ]

  return (
    <div>
      <Card style={{ borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>公告管理</span>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>发布公告</Button>
        </div>
        <Table columns={cols} dataSource={list} rowKey="id" loading={loading} pagination={false} />
      </Card>

      <Modal title={editRecord ? '编辑公告' : '发布公告'} open={modalVisible}
        onCancel={() => setModalVisible(false)} onOk={() => form.submit()} width={600}>
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input placeholder="公告标题" />
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true }]}>
            <Input.TextArea rows={5} placeholder="公告内容" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="type" label="类型" initialValue="system">
              <Select>{Object.entries(typeMap).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}</Select>
            </Form.Item>
            <Form.Item name="status" label="状态" initialValue={1}>
              <Select><Option value={1}>立即发布</Option><Option value={0}>保存草稿</Option></Select>
            </Form.Item>
            <Form.Item name="top" label="置顶" initialValue={0}>
              <Select><Option value={0}>不置顶</Option><Option value={1}>置顶</Option></Select>
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
