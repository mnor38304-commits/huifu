import { useState, useEffect } from 'react'
import { Table, Button, Tag, Space, Card, Modal, Input, message, Descriptions } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { getKycPending, auditKyc } from '../api'

export default function KycAudit() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [rejectModal, setRejectModal] = useState<{ visible: boolean; id: number | null }>({ visible: false, id: null })
  const [rejectReason, setRejectReason] = useState('')
  const [detailModal, setDetailModal] = useState<{ visible: boolean; record: any }>({ visible: false, record: null })

  useEffect(() => { load() }, [page])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getKycPending({ page, pageSize: 20 })
      if (r.code === 0) { setList(r.data.list); setTotal(r.data.total) }
    } finally { setLoading(false) }
  }

  const approve = async (id: number) => {
    const r: any = await auditKyc(id, 'approve')
    if (r.code === 0) { message.success('审核通过'); load() }
  }

  const reject = async () => {
    if (!rejectReason.trim()) return message.error('请填写拒绝原因')
    const r: any = await auditKyc(rejectModal.id!, 'reject', rejectReason)
    if (r.code === 0) { message.success('已拒绝'); setRejectModal({ visible: false, id: null }); setRejectReason(''); load() }
  }

  const subjectMap: Record<number, string> = { 1: '个人', 2: '企业' }
  const idTypeMap: Record<number, string> = { 1: '身份证', 2: '护照', 3: '营业执照' }

  const cols = [
    { title: '用户编号', dataIndex: 'user_no', key: 'user_no', width: 160 },
    { title: '手机号', dataIndex: 'phone', key: 'phone', width: 130 },
    { title: '主体类型', dataIndex: 'subject_type', key: 'subject_type', width: 90,
      render: (v: number) => <Tag color={v===1?'blue':'orange'}>{subjectMap[v]}</Tag> },
    { title: '姓名', dataIndex: 'real_name', key: 'real_name', width: 100 },
    { title: '证件类型', dataIndex: 'id_type', key: 'id_type', width: 100,
      render: (v: number) => idTypeMap[v] },
    { title: '提交时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v?.replace('T', ' ').split('.')[0] },
    { title: '操作', key: 'action', fixed: 'right' as const, width: 200,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => setDetailModal({ visible: true, record: r })}>查看</Button>
          <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => approve(r.id)}>通过</Button>
          <Button danger size="small" icon={<CloseOutlined />} onClick={() => setRejectModal({ visible: true, id: r.id })}>拒绝</Button>
        </Space>
      )
    }
  ]

  return (
    <div>
      <Card style={{ borderRadius: 8 }}>
        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>KYC 待审核</span>
          <Tag color="orange" style={{ marginLeft: 8 }}>{total} 条待处理</Tag>
        </div>
        <Table columns={cols} dataSource={list} rowKey="id" loading={loading} scroll={{ x: 900 }}
          pagination={{ total, current: page, pageSize: 20, onChange: setPage }} />
      </Card>

      <Modal title="KYC详情" open={detailModal.visible} onCancel={() => setDetailModal({ visible: false, record: null })} footer={[
        <Button key="approve" type="primary" onClick={() => { approve(detailModal.record?.id); setDetailModal({ visible: false, record: null }) }}>审核通过</Button>,
        <Button key="reject" danger onClick={() => { setDetailModal({ visible: false, record: null }); setRejectModal({ visible: true, id: detailModal.record?.id }) }}>拒绝</Button>,
      ]}>
        {detailModal.record && <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="用户编号">{detailModal.record.user_no}</Descriptions.Item>
          <Descriptions.Item label="手机号">{detailModal.record.phone}</Descriptions.Item>
          <Descriptions.Item label="主体类型">{subjectMap[detailModal.record.subject_type]}</Descriptions.Item>
          <Descriptions.Item label="证件类型">{idTypeMap[detailModal.record.id_type]}</Descriptions.Item>
          <Descriptions.Item label="姓名/企业名">{detailModal.record.real_name}</Descriptions.Item>
          <Descriptions.Item label="证件号码">{detailModal.record.id_number}</Descriptions.Item>
          <Descriptions.Item label="提交时间" span={2}>{detailModal.record.created_at}</Descriptions.Item>
        </Descriptions>}
      </Modal>

      <Modal title="拒绝原因" open={rejectModal.visible} onOk={reject} onCancel={() => setRejectModal({ visible: false, id: null })} okText="确认拒绝" okButtonProps={{ danger: true }}>
        <Input.TextArea rows={4} placeholder="请填写拒绝原因（将通知商户）" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
      </Modal>
    </div>
  )
}
