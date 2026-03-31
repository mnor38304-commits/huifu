import { useState, useEffect } from 'react'
import { Table, Select, Input, DatePicker, Button, Tag, Space, Card } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { getTransactions, getCards } from '../services/api'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker
const { Option } = Select

const Transactions: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState<any[]>([])
  const [cards, setCards] = useState<any[]>([])
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [filters, setFilters] = useState<any>({})

  useEffect(() => {
    loadCards()
  }, [])

  useEffect(() => {
    loadTransactions()
  }, [pagination.current, filters])

  const loadCards = async () => {
    try {
      const res = await getCards()
      if (res.code === 0) {
        setCards(res.data || [])
      }
    } catch (error) {
      console.error(error)
    }
  }

  const loadTransactions = async () => {
    setLoading(true)
    try {
      const res = await getTransactions({
        ...filters,
        page: pagination.current,
        pageSize: pagination.pageSize
      })
      if (res.code === 0) {
        setTransactions(res.data?.list || [])
        setPagination({ ...pagination, total: res.data?.total || 0 })
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (values: any) => {
    const [startDate, endDate] = values.dateRange || []
    setFilters({
      ...filters,
      cardId: values.cardId,
      txnType: values.txnType,
      status: values.status,
      startDate: startDate?.format('YYYY-MM-DD'),
      endDate: endDate?.format('YYYY-MM-DD'),
      keyword: values.keyword
    })
    setPagination({ ...pagination, current: 1 })
  }

  const typeMap: Record<string, { text: string; color: string }> = {
    PURCHASE: { text: '消费', color: 'red' },
    REFUND: { text: '退款', color: 'green' },
    TOPUP: { text: '充值', color: 'blue' },
    FEE: { text: '手续费', color: 'orange' },
    MONTHLY_FEE: { text: '月费', color: 'orange' },
    CANCEL_REFUND: { text: '销卡退款', color: 'green' },
  }

  const statusMap: Record<number, { text: string; color: string }> = {
    0: { text: '处理中', color: 'processing' },
    1: { text: '成功', color: 'success' },
    2: { text: '失败', color: 'error' },
    3: { text: '已撤销', color: 'default' },
  }

  const columns = [
    {
      title: '交易时间',
      dataIndex: 'txn_time',
      key: 'txn_time',
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '卡号',
      dataIndex: 'card_no_masked',
      key: 'card_no_masked',
    },
    {
      title: '卡片名称',
      dataIndex: 'card_name',
      key: 'card_name',
    },
    {
      title: '交易类型',
      dataIndex: 'txn_type',
      key: 'txn_type',
      render: (type: string) => <Tag color={typeMap[type]?.color}>{typeMap[type]?.text || type}</Tag>,
    },
    {
      title: '商户',
      dataIndex: 'merchant_name',
      key: 'merchant_name',
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount: number) => (
        <span style={{ color: amount > 0 ? '#52c41a' : '#ff4d4f', fontWeight: 'bold' }}>
          {amount > 0 ? '+' : ''}{amount?.toFixed(2)}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: number) => <Tag color={statusMap[status]?.color}>{statusMap[status]?.text}</Tag>,
    },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>交易查询</h2>
      
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select 
            placeholder="全部卡片" 
            style={{ width: 150 }}
            allowClear
            onChange={v => setFilters({ ...filters, cardId: v })}
          >
            {cards.map(card => (
              <Option key={card.id} value={card.id}>{card.card_name} ({card.card_no_masked})</Option>
            ))}
          </Select>
          
          <Select 
            placeholder="全部类型" 
            style={{ width: 120 }}
            allowClear
            onChange={v => setFilters({ ...filters, txnType: v })}
          >
            <Option value="PURCHASE">消费</Option>
            <Option value="REFUND">退款</Option>
            <Option value="TOPUP">充值</Option>
            <Option value="FEE">手续费</Option>
          </Select>
          
          <Select 
            placeholder="全部状态" 
            style={{ width: 100 }}
            allowClear
            onChange={v => setFilters({ ...filters, status: v })}
          >
            <Option value={1}>成功</Option>
            <Option value={2}>失败</Option>
            <Option value={0}>处理中</Option>
          </Select>
          
          <RangePicker 
            onChange={(dates) => {
              setFilters({
                ...filters,
                startDate: dates?.[0]?.format('YYYY-MM-DD'),
                endDate: dates?.[1]?.format('YYYY-MM-DD')
              })
            }}
          />
          
          <Input 
            placeholder="搜索商户" 
            prefix={<SearchOutlined />} 
            style={{ width: 200 }}
            onChange={e => setFilters({ ...filters, keyword: e.target.value })}
          />
        </Space>
      </Card>

      <Table 
        columns={columns} 
        dataSource={transactions} 
        rowKey="id"
        loading={loading}
        pagination={{
          ...pagination,
          onChange: (page) => setPagination({ ...pagination, current: page }),
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`
        }}
      />
    </div>
  )
}

export default Transactions