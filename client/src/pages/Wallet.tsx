import { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Alert, QRCode, Tabs, Empty } from 'antd';
import { WalletOutlined, QrcodeOutlined, HistoryOutlined, CopyOutlined, CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { getWalletInfo, getWalletStats, getWalletAddress, createC2COrder, getDepositList } from '../services/api';

const { TabPane } = Tabs;

export default function Wallet() {
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [depositList, setDepositList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // 充值模态框
  const [depositModal, setDepositModal] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositForm] = Form.useForm();
  const [currentOrder, setCurrentOrder] = useState<any>(null);
  const [selectedNetwork, setSelectedNetwork] = useState('TRC20');

  // 获取钱包信息
  const loadWallet = async () => {
    try {
      const r: any = await getWalletInfo();
      if (r.code === 0) {
        setWallet(r.data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 获取统计数据
  const loadStats = async () => {
    try {
      const r: any = await getWalletStats();
      if (r.code === 0) {
        setStats(r.data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 获取充值记录
  const loadDeposits = async () => {
    try {
      const r: any = await getDepositList({ page, pageSize });
      if (r.code === 0) {
        setDepositList(r.data.list);
        setTotal(r.data.total);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    Promise.all([loadWallet(), loadStats(), loadDeposits()]).finally(() => setLoading(false));
  }, [page, pageSize]);

  // 创建充值订单
  const handleCreateDeposit = async (values: any) => {
    setDepositLoading(true);
    try {
      const r: any = await createC2COrder({ amountUsdt: values.amount, network: values.network });
      if (r.code === 0) {
        setCurrentOrder(r.data);
        message.success('充值订单创建成功');
        await loadDeposits();
      } else {
        message.error(r.message || '创建失败');
      }
    } catch (e: any) {
      message.error(e.response?.data?.message || '创建失败');
    } finally {
      setDepositLoading(false);
    }
  };

  // 复制地址
  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    message.success('地址已复制');
  };

  // 状态映射
  const statusMap: Record<number, { text: string; color: string }> = {
    0: { text: '待支付', color: 'orange' },
    1: { text: '已支付', color: 'blue' },
    2: { text: '已确认', color: 'green' },
    3: { text: '已过期', color: 'gray' },
    4: { text: '失败', color: 'red' }
  };

  // 充值记录表格列
  const columns = [
    { title: '订单号', dataIndex: 'order_no', key: 'order_no', width: 180, ellipsis: true },
    { title: '金额(USDT)', dataIndex: 'amount_usdt', key: 'amount_usdt', width: 100,
      render: (v: number) => v?.toFixed(2) },
    { title: '金额(USD)', dataIndex: 'amount_usd', key: 'amount_usd', width: 100,
      render: (v: number) => `$${v?.toFixed(2)}` },
    { title: '网络', dataIndex: 'network', key: 'network', width: 80 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: number) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.text}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v?.replace('T', ' ').split('.')[0] }
  ];

  return (
    <div>
      <Tabs defaultActiveKey="1">
        <TabPane tab={<span><WalletOutlined /> 钱包</span>} key="1">
          {/* 余额卡片 */}
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Card bordered={false}>
                <Statistic
                  title="USD 余额"
                  value={wallet?.balance_usd || 0}
                  precision={2}
                  prefix="$"
                  loading={loading}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card bordered={false}>
                <Statistic
                  title="USDT 余额"
                  value={wallet?.balance_usdt || 0}
                  precision={2}
                  prefix="⬢"
                  loading={loading}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card bordered={false}>
                <Statistic
                  title="锁定金额"
                  value={wallet?.locked_usd || 0}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#faad14' }}
                  loading={loading}
                />
              </Card>
            </Col>
          </Row>

          {/* 统计卡片 */}
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Card bordered={false}>
                <Statistic
                  title="今日充值"
                  value={stats?.todayDeposit || 0}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#52c41a' }}
                  loading={loading}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card bordered={false}>
                <Statistic
                  title="本月充值"
                  value={stats?.monthDeposit || 0}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#1890ff' }}
                  loading={loading}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card bordered={false} style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Button type="primary" size="large" icon={<WalletOutlined />} onClick={() => setDepositModal(true)}>
                  USDT 充值
                </Button>
              </Card>
            </Col>
          </Row>

          {/* 操作说明 */}
          <Card title="充值说明" bordered={false} style={{ marginBottom: 24 }}>
            <Row gutter={24}>
              <Col span={8}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>1️⃣</div>
                  <div style={{ fontWeight: 500 }}>创建充值订单</div>
                  <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>输入您要充值的USDT数量</div>
                </div>
              </Col>
              <Col span={8}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>2️⃣</div>
                  <div style={{ fontWeight: 500 }}>向收款地址转账</div>
                  <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>使用USDT向显示的地址转账</div>
                </div>
              </Col>
              <Col span={8}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>3️⃣</div>
                  <div style={{ fontWeight: 500 }}>自动到账</div>
                  <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>确认后自动充值到钱包</div>
                </div>
              </Col>
            </Row>
          </Card>
        </TabPane>

        <TabPane tab={<span><HistoryOutlined /> 充值记录</span>} key="2">
          <Card bordered={false}>
            {depositList.length > 0 ? (
              <>
                <Table
                  dataSource={depositList}
                  columns={columns}
                  rowKey="id"
                  loading={loading}
                  pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (t) => `共 ${t} 条`,
                    onChange: (p, ps) => {
                      setPage(p);
                      setPageSize(ps);
                    }
                  }}
                />
              </>
            ) : (
              <Empty description="暂无充值记录" />
            )}
          </Card>
        </TabPane>
      </Tabs>

      {/* 充值模态框 */}
      <Modal
        title="USDT 充值"
        open={depositModal}
        onCancel={() => {
          setDepositModal(false);
          setCurrentOrder(null);
          depositForm.resetFields();
        }}
        footer={null}
        width={600}
      >
        {!currentOrder ? (
          <>
            <Alert
              message="充值须知"
              description={
                <div>
                  <p>• 支持 TRC20(波场)、ERC20(以太坊)、BEP20(BSC) 网络</p>
                  <p>• 请确保使用相同的网络地址进行转账</p>
                  <p>• 到账时间取决于区块链确认速度</p>
                </div>
              }
              type="info"
              style={{ marginBottom: 24 }}
            />

            <Form form={depositForm} onFinish={handleCreateDeposit} layout="vertical">
              <Form.Item label="充值金额 (USDT)" name="amount" rules={[
                { required: true, message: '请输入充值金额' },
                { pattern: /^[0-9]+(\.[0-9]{1,6})?$/, message: '请输入有效金额' }
              ]}>
                <Input type="number" placeholder="请输入充值USDT数量" size="large" min={0.01} step={0.01} />
              </Form.Item>

              <Form.Item label="网络" name="network" initialValue="TRC20" rules={[{ required: true }]}>
                <Select size="large" onChange={(v) => setSelectedNetwork(v)}>
                  <Select.Option value="TRC20">TRC20 (波场) - 推荐</Select.Option>
                  <Select.Option value="ERC20">ERC20 (以太坊)</Select.Option>
                  <Select.Option value="BEP20">BEP20 (BSC)</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item>
                <Button type="primary" htmlType="submit" block size="large" loading={depositLoading}>
                  创建充值订单
                </Button>
              </Form.Item>
            </Form>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>
                <CheckCircleOutlined style={{ color: '#52c41a' }} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 500 }}>订单创建成功</div>
              <div style={{ color: '#666', marginTop: 8 }}>
                请向以下地址转账 {currentOrder.amountUsdt} USDT
              </div>
            </div>

            <Card style={{ background: '#f5f5f5', marginBottom: 24 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ color: '#666', fontSize: 12 }}>充值金额</div>
                  <div style={{ fontSize: 24, fontWeight: 500 }}>{currentOrder.amountUsdt} USDT</div>
                </Col>
                <Col span={12}>
                  <div style={{ color: '#666', fontSize: 12 }}>约等值</div>
                  <div style={{ fontSize: 24, fontWeight: 500 }}>${currentOrder.amountUsd?.toFixed(2)}</div>
                </Col>
              </Row>
              <div style={{ marginTop: 16 }}>
                <div style={{ color: '#666', fontSize: 12 }}>网络</div>
                <div style={{ fontWeight: 500 }}>{currentOrder.network}</div>
              </div>
            </Card>

            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>收款地址（向此地址转账）</div>
              {currentOrder.payAddress && (
                <QRCode value={currentOrder.payAddress} size={200} style={{ marginBottom: 16 }} />
              )}
              <div style={{
                background: '#fff',
                padding: '12px 16px',
                borderRadius: 8,
                border: '1px solid #d9d9d9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{currentOrder.payAddress}</span>
                <Button type="text" icon={<CopyOutlined />} onClick={() => copyAddress(currentOrder.payAddress)}>
                  复制
                </Button>
              </div>
            </div>

            <Alert
              message={`请在 ${new Date(currentOrder.expireAt).toLocaleString()} 前完成转账`}
              type="warning"
              style={{ marginBottom: 16 }}
            />

            <Space style={{ width: '100%', justifyContent: 'center' }}>
              <Button onClick={() => {
                setCurrentOrder(null);
                depositForm.resetFields();
              }}>
                再充值一笔
              </Button>
              <Button type="primary" onClick={() => {
                setDepositModal(false);
                setCurrentOrder(null);
                depositForm.resetFields();
              }}>
                完成
              </Button>
            </Space>
          </>
        )}
      </Modal>
    </div>
  );
}
