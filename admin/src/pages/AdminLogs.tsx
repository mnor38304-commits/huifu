import { useState, useEffect } from 'react'
import { Table, Card, Tag } from 'antd'
import { getLogs } from '../api'

const actionColors: Record<string, string> = {
  '启用商户': 'green', '禁用商户': 'red', 'KYC审核通过': 'green', 'KYC审核拒绝': 'red',
  '冻结卡片': 'orange', '解冻卡片': 'blue', '确认USDT到账': 'green', '创建BIN': 'blue', '更新BIN费率': 'orange'
}

export default function AdminLogs() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  useEffect(() => { load() }, [page])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getLogs({ page, pageSize: 20 })
      if (r.code === 0) { setList(r.data.list); setTotal(r.data.total) }
    } finally { setLoading(false) }
  }

  const cols = [
    { title: '操作人', dataIndex: 'admin_name', key: 'admin_name', width: 120 },
    { title: '操作', dataIndex: 'action', key: 'action', width: 160,
      render: (v: string) => <Tag color={actionColors[v] || 'default'}>{v}</Tag> },
    { title: '对象类型', dataIndex: 'target_type', key: 'target_type', width: 100 },
    { title: '对象ID', dataIndex: 'target_id', key: 'target_id', width: 80 },
    { title: '详情', dataIndex: 'detail', key: 'detail' },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 130 },
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v?.replace('T',' ').split('.')[0] },
  ]

  return (
    <Card style={{ borderRadius: 8 }}>
      <div style={{ marginBottom: 12, fontSize: 16, fontWeight: 600 }}>操作日志</div>
      <Table columns={cols} dataSource={list} rowKey="id" loading={loading}
        pagination={{ total, current: page, pageSize: 20, onChange: setPage }} />
    </Card>
  )
}
