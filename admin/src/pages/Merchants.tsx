import { useState, useEffect } from 'react'
import { Table, Input, Select, Button, Tag, Space, Card, Modal, Descriptions, message, Alert } from 'antd'
import { SearchOutlined, EyeOutlined, StopOutlined, CheckOutlined, SettingOutlined } from '@ant-design/icons'
import { getMerchants, getMerchantDetail, setMerchantStatus, getMerchantBinPermissions, updateMerchantBinPermissions } from '../api'

const { Option } = Select

const kycMap: Record<number, { text: string; color: string }> = {
  0: { text: '未认证', color: 'default' }, 1: { text: '认证中', color: 'processing' },
  2: { text: '已认证', color: 'success' }, 3: { text: '认证失败', color: 'error' }
}
const statusMap: Record<number, { text: string; color: string }> = {
  1: { text: '正常', color: 'green' }, 2: { text: '禁用', color: 'red' }
}

export default function Merchants() {
  const [list, setList] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: 20 })
  const [detail, setDetail] = useState<any>(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const [binConfigVisible, setBinConfigVisible] = useState(false)
  const [binSaving, setBinSaving] = useState(false)
  const [binMerchant, setBinMerchant] = useState<any>(null)
  const [allBins, setAllBins] = useState<any[]>([])
  const [selectedBinIds, setSelectedBinIds] = useState<number[]>([])
  const [restricted, setRestricted] = useState(false)

  useEffect(() => { load() }, [filters])

  const load = async () => {
    setLoading(true)
    try {
      const r: any = await getMerchants(filters)
      if (r.code === 0) { setList(r.data.list); setTotal(r.data.total) }
    } finally { setLoading(false) }
  }

  const viewDetail = async (id: number) => {
    const r: any = await getMerchantDetail(id)
    if (r.code === 0) { setDetail(r.data); setDetailVisible(true) }
  }

  const openBinConfig = async (record: any) => {
    setBinMerchant(record)
    const r: any = await getMerchantBinPermissions(record.id)
    if (r.code === 0) {
      setAllBins(r.data.allBins || [])
      setSelectedBinIds(r.data.assignedBinIds || [])
      setRestricted(!!r.data.restricted)
      setBinConfigVisible(true)
    } else {
      message.error(r.message)
    }
  }

  const saveBinConfig = async () => {
    if (!binMerchant) return
    setBinSaving(true)
    try {
      const r: any = await updateMerchantBinPermissions(binMerchant.id, selectedBinIds)
      if (r.code === 0) {
        message.success(r.message || '商户卡段授权已更新')
        setBinConfigVisible(false)
        if (detail?.user?.id === binMerchant.id) {
          viewDetail(binMerchant.id)
        }
      } else {
        message.error(r.message)
      }
    } finally {
      setBinSaving(false)
    }
  }

  const toggleStatus = async (id: number, cur: number) => {
    const newStatus = cur === 1 ? 2 : 1
    const r: any = await setMerchantStatus(id, newStatus)
    if (r.code === 0) { message.success('操作成功'); load() }
  }

  const cols = [
    { title: '用户编号', dataIndex: 'user_no', key: 'user_no', width: 160 },
    { title: '手机号', dataIndex: 'phone', key: 'phone', width: 130 },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 180 },
    { title: 'KYC状态', dataIndex: 'kyc_status', key: 'kyc_status', width: 100,
      render: (v: number) => <Tag color={kycMap[v]?.color}>{kycMap[v]?.text}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: number) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text}</Tag> },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v?.split('T')[0] },
    { title: '操作', key: 'action', fixed: 'right' as const, width: 220,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => viewDetail(r.id)}><EyeOutlined /> 详情</Button>
          <Button type="link" size="small" onClick={() => openBinConfig(r)}><SettingOutlined /> 卡段</Button>
          <Button type="link" size="small" danger={r.status===1} onClick={() => toggleStatus(r.id, r.status)}>
            {r.status === 1 ? <><StopOutlined /> 禁用</> : <><CheckOutlined /> 启用</>}
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div>
      <Card style={{ marginBottom: 16, borderRadius: 8 }}>
        <Space wrap>
          <Input placeholder="搜索手机号/邮箱/用户编号" prefix={<SearchOutlined />} style={{ width: 240 }}
            onChange={e => setFilters({ ...filters, keyword: e.target.value, page: 1 })} />
          <Select placeholder="账号状态" style={{ width: 120 }} allowClear onChange={v => setFilters({ ...filters, status: v, page: 1 })}>
            <Option value={1}>正常</Option><Option value={2}>禁用</Option>
          </Select>
          <Select placeholder="KYC状态" style={{ width: 120 }} allowClear onChange={v => setFilters({ ...filters, kycStatus: v, page: 1 })}>
            <Option value={0}>未认证</Option><Option value={1}>认证中</Option>
            <Option value={2}>已认证</Option><Option value={3}>认证失败</Option>
          </Select>
        </Space>
      </Card>

      <Card style={{ borderRadius: 8 }}>
        <div style={{ marginBottom: 12, color: '#666' }}>共 <strong>{total}</strong> 个商户</div>
        <Table columns={cols} dataSource={list} rowKey="id" loading={loading} scroll={{ x: 1100 }}
          pagination={{ total, current: filters.page, pageSize: filters.pageSize, showSizeChanger: true,
            onChange: (p, ps) => setFilters({ ...filters, page: p, pageSize: ps }) }} />
      </Card>

      <Modal title="商户详情" open={detailVisible} onCancel={() => setDetailVisible(false)} footer={null} width={760}>
        {detail && <>
          <Descriptions title="基本信息" column={2} bordered size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="用户编号">{detail.user?.user_no}</Descriptions.Item>
            <Descriptions.Item label="手机号">{detail.user?.phone}</Descriptions.Item>
            <Descriptions.Item label="邮箱">{detail.user?.email}</Descriptions.Item>
            <Descriptions.Item label="KYC状态"><Tag color={kycMap[detail.user?.kyc_status]?.color}>{kycMap[detail.user?.kyc_status]?.text}</Tag></Descriptions.Item>
            <Descriptions.Item label="交易笔数">{detail.txnStats?.count}</Descriptions.Item>
            <Descriptions.Item label="交易总额">${(detail.txnStats?.volume||0).toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="可开通卡段" span={2}>
              {detail.binPermissions?.restricted
                ? (detail.binPermissions?.allBins || []).filter((bin: any) => (detail.binPermissions?.assignedBinIds || []).includes(bin.id)).map((bin: any) => (
                    <Tag key={bin.id} color="blue" style={{ marginBottom: 6 }}>{bin.bin_code} - {bin.bin_name}</Tag>
                  ))
                : <Tag color="green">默认全部启用卡段</Tag>}
            </Descriptions.Item>
          </Descriptions>
          {detail.kyc && <Descriptions title="KYC信息" column={2} bordered size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="姓名">{detail.kyc?.real_name}</Descriptions.Item>
            <Descriptions.Item label="证件号">{detail.kyc?.id_number}</Descriptions.Item>
          </Descriptions>}
          <div><strong>卡片列表</strong>
            <Table size="small" style={{ marginTop: 8 }} dataSource={detail.cards} rowKey="id" pagination={false}
              columns={[
                { title: '卡号', dataIndex: 'card_no_masked' },
                { title: '名称', dataIndex: 'card_name' },
                { title: 'BIN ID', dataIndex: 'bin_id' },
                { title: '余额', dataIndex: 'balance', render: (v: number) => `$${v?.toFixed(2)}` },
                { title: '状态', dataIndex: 'status', render: (v: number) => <Tag color={v===1?'green':v===2?'orange':'default'}>{v===1?'正常':v===2?'冻结':'其他'}</Tag> },
              ]} />
          </div>
        </>}
      </Modal>

      <Modal
        title={binMerchant ? `设置商户可开通卡段 - ${binMerchant.user_no}` : '设置商户可开通卡段'}
        open={binConfigVisible}
        onCancel={() => setBinConfigVisible(false)}
        onOk={saveBinConfig}
        confirmLoading={binSaving}
        okText="保存设置"
        width={720}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="不选择任何卡段时，商户默认可以开通所有已启用 BIN；选择后，商户只能开通你勾选的卡段。"
        />
        <div style={{ marginBottom: 12, color: '#666' }}>
          当前模式：{restricted ? '按授权卡段限制开通' : '默认全部启用卡段可开通'}
        </div>
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%' }}
          placeholder="请选择允许该商户开通的卡段"
          value={selectedBinIds}
          onChange={(vals) => { setSelectedBinIds(vals as number[]); setRestricted((vals as number[]).length > 0) }}
          optionFilterProp="label"
          maxTagCount="responsive"
          options={allBins.filter(bin => bin.status === 1).map(bin => ({
            value: bin.id,
            label: `${bin.bin_code} - ${bin.bin_name}${bin.channel_code ? ` [${bin.channel_code}]` : ''}`
          }))}
        />
      </Modal>
    </div>
  )
}
