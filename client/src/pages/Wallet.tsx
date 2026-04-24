import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Statistic, Table, Button, Modal, Form, Input, Select, Tag, Space, message, Alert, QRCode, Tabs, Empty, Spin, Steps } from 'antd';
import { WalletOutlined, QrcodeOutlined, HistoryOutlined, CopyOutlined, CheckCircleOutlined, SyncOutlined, LoadingOutlined, LinkOutlined } from '@ant-design/icons';
import { getWalletInfo, getWalletStats, getDepositList, checkDepositStatus } from '../services/api';

const { TabPane } = Tabs;

export default function Wallet() {
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [depositList, setDepositList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // 充值表单模态框
  const [depositModal, setDepositModal] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositForm] = Form.useForm();

  // 收银台模态框（CoinPal）
  const [cashierModal, setCashierModal] = useState(false);
  const [cashierData, setCashierData] = useState<any>(null);
  const [paymentStep, setPaymentStep] = useState(0); // 0:下单 1:支付中 2:成功/失败
  const [pollingTimer, setPollingTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  // 传统地址模态框
  const [addressModal, setAddressModal] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<any>(null);
  const [selectedNetwork, setSelectedNetwork] = useState('TRC20');

  // ── 加载钱包信息 ────────────────────────────────────────────────
  const loadWallet = async () => {
    try {
      const r: any = await getWalletInfo();
      if (r.code === 0) setWallet(r.data);
    } catch (e) { console.error(e); }
  };

  // ── 加载统计数据 ────────────────────────────────────────────────
  const loadStats = async () => {
    try {
      const r: any = await getWalletStats();
      if (r.code === 0) setStats(r.data);
    } catch (e) { console.error(e); }
  };

  // ── 加载充值记录 ────────────────────────────────────────────────
  const loadDeposits = async () => {
    try {
      const r: any = await getDepositList({ page, pageSize });
      if (r.code === 0) {
        setDepositList(r.data.list);
        setTotal(r.data.total);
      }
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    Promise.all([loadWallet(), loadStats(), loadDeposits()]).finally(() => setLoading(false));
    // 检查 URL 参数（CoinPal 回调跳转回来时）
    const params = new URLSearchParams(window.location.search);
    if (params.get('status') === 'success') {
      message.success('充值成功！');
      loadWallet();
      loadDeposits();
      window.history.replaceState({}, '', '/wallet');
    }
    // eslint-disable-next-line
  }, [page, pageSize]);

  // ── 关闭收银台时清理轮询 ────────────────────────────────────────
  const clearPolling = useCallback(() => {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      setPollingTimer(null);
    }
  }, [pollingTimer]);

  // ── 轮询查询 CoinPal 订单状态 ──────────────────────────────────
  const startPollingStatus = useCallback((orderNo: string) => {
    let count = 0;
    const timer = setInterval(async () => {
      count++;
      try {
        const r: any = await checkDepositStatus(orderNo);
        if (r.code === 0 && r.data) {
          const order = r.data;
          if (order.status === 1) {
            // 充值成功
            clearPolling();
            setPaymentStep(2);
            message.success('充值成功！金额已到账。');
            loadWallet();
            loadDeposits();
          } else if (order.status === 2) {
            // 充值失败
            clearPolling();
            setPaymentStep(2);
            message.error('充值失败，请联系客服处理。');
          } else if (count >= 60) {
            // 超时（30分钟）
            clearPolling();
            setPaymentStep(2);
            message.warning('支付超时，请检查是否已完成转账。');
          }
        }
      } catch (e) {
        console.error('轮询失败:', e);
      }
    }, 30000); // 每 30 秒轮询一次，最长 30 分钟
    setPollingTimer(timer);
  }, [clearPolling]);

  // ── 打开收银台 ─────────────────────────────────────────────────
  const openCashier = (data: any) => {
    setCashierData(data);
    setPaymentStep(1); // 支付中
    setCashierModal(true);
    startPollingStatus(data.orderNo);
  };

  // ── 打开传统地址模式 ───────────────────────────────────────────
  const openAddressModal = (data: any) => {
    setCurrentOrder(data);
    setAddressModal(true);
  };

  // ── 创建充值订单 ───────────────────────────────────────────────
  const handleCreateDeposit = async (values: any) => {
    setDepositLoading(true);
    setDepositModal(false);
    try {
      const r: any = await (await import('../services/api')).createC2COrder({
        amountUsdt: values.amount,
        network: values.network,
      });
      if (r.code === 0) {
        const data = r.data;
        if (data.paymentUrl) {
          // CoinPal 收银台模式：弹窗展示扫码充值
          openCashier(data);
        } else if (data.payAddress) {
          // 传统地址模式：显示收款地址
          openAddressModal(data);
        } else {
          message.warning('返回数据异常，请稍后重试');
        }
      } else {
        message.error(r.message || '创建失败');
      }
    } catch (e: any) {
      message.error(e?.message || e?.response?.data?.message || '创建失败');
    } finally {
      setDepositLoading(false);
    }
  };

  // ── 复制地址 ───────────────────────────────────────────────────
  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address).then(() => message.success('地址已复制'));
  };

  // ── 状态映射 ───────────────────────────────────────────────────
  const statusMap: Record<number, { color: string; text: string }> = {
    0: { color: 'orange', text: '待支付' },
    1: { color: 'green', text: '已完成' },
    2: { color: 'red', text: '已失败' },
  };

  const channelMap: Record<string, string> = {
    COINPAL: 'CoinPal',
    UQPAY: 'UQPay',
    DOGPAY: 'DogPay',
  };

  // ── 表格列定义 ─────────────────────────────────────────────────
  const columns = [
    { title: '订单号', dataIndex: 'order_no', key: 'order_no',
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> },
    { title: '金额 (USDT)', dataIndex: 'amount_usdt', key: 'amount_usdt',
      render: (v: number) => <Tag color="blue">{v}</Tag> },
    { title: '网络', dataIndex: 'network', key: 'network' },
    { title: '渠道', dataIndex: 'channel',
      render: (_: any, r: any) => channelMap[r.channel] || r.channel || '-' },
    { title: '状态', dataIndex: 'status', key: 'status',
      render: (v: number) => {
        const s = statusMap[v] || { color: 'default', text: '未知' };
        return <Tag color={s.color}>{s.text}</Tag>;
      }},
    { title: '时间', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => new Date(v).toLocaleString('zh-CN') },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}><WalletOutlined /> 我的钱包</h2>
        <Button type="primary" icon={<QrcodeOutlined />} onClick={() => setDepositModal(true)}>
          充值 USDT
        </Button>
      </div>

      {/* 余额卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card><Statistic title="USD 余额" value={wallet?.balance_usd || 0} prefix="$" /></Card>
        </Col>
        <Col span={8}>
          <Card><Statistic title="USDT 余额" value={wallet?.balance_usdt || 0} prefix="₮" /></Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="累计充值" value={stats?.totalDeposited || 0} suffix="USDT" />
            <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
              共 {stats?.depositCount || 0} 笔充值
            </div>
          </Card>
        </Col>
      </Row>

      {/* 充值记录表格 */}
      <Card title={<><HistoryOutlined /> 充值记录</>}>
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
            showTotal: (t: number) => `共 ${t} 条`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </Card>

      {/* ── 充值金额表单模态框 ───────────────────────────────── */}
      <Modal
        title="充值 USDT"
        open={depositModal}
        onCancel={() => setDepositModal(false)}
        footer={null}
      >
        <Form form={depositForm} layout="vertical" onFinish={handleCreateDeposit}>
          <Form.Item label="充值金额 (USDT)" name="amount" rules={[{ required: true, message: '请输入充值金额' }]}>
            <Input type="number" placeholder="请输入 USDT 数量，如 100" min={1} />
          </Form.Item>
          <Form.Item label="网络" name="network" initialValue="TRC20">
            <Select>
              <Select.Option value="TRC20">TRC20 (TRON) - 推荐</Select.Option>
              <Select.Option value="ERC20">ERC20 (Ethereum)</Select.Option>
              <Select.Option value="BEP20">BEP20 (BNB Chain)</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={depositLoading}>
              {depositLoading ? '创建订单中...' : '发起充值'}
            </Button>
          </Form.Item>
        </Form>
        <Alert
          message="CoinPal 提供安全加密货币支付服务，支持 TRC20/ERC20/BEP20 网络。"
          type="info"
          style={{ marginTop: 8 }}
        />
      </Modal>

      {/* ── CoinPal 收银台模态框 ─────────────────────────────── */}
      <Modal
        open={cashierModal}
        title="CoinPal 收银台"
        footer={null}
        closable={paymentStep < 2}
        maskClosable={paymentStep < 2}
        width={520}
        afterClose={() => { clearPolling(); setCashierData(null); setPaymentStep(0); }}
        onCancel={() => {
          if (paymentStep < 2) return;
          setCashierModal(false);
        }}
      >
        {/* 步骤条 */}
        <Steps
          current={paymentStep}
          style={{ marginBottom: 24 }}
          items={[
            { title: '创建订单', icon: <CheckCircleOutlined /> },
            { title: '完成支付', icon: paymentStep === 1 ? <LoadingOutlined /> : <SyncOutlined /> },
            { title: paymentStep === 2 && cashierData?.status === 1 ? '充值成功' : '等待确认', icon: <CheckCircleOutlined /> },
          ]}
        />

        {paymentStep === 1 && cashierData && (
          <>
            {/* 金额展示 */}
            <div style={{ textAlign: 'center', background: '#f0f7ff', padding: 16, borderRadius: 8, marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: '#666' }}>需充值金额</div>
              <div style={{ fontSize: 36, fontWeight: 700, color: '#1890ff' }}>
                {cashierData.amountUsdt} <span style={{ fontSize: 16 }}>USDT</span>
              </div>
              <div style={{ color: '#999', fontSize: 12 }}>≈ ${cashierData.amountUsdt} USD</div>
            </div>

            {/* 二维码 */}
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
                <QrcodeOutlined /> 扫码支付（CoinPal）
              </div>
              {cashierData.paymentUrl && (
                <QRCode
                  value={cashierData.paymentUrl}
                  size={220}
                  style={{ border: '8px solid #f5f5f5', borderRadius: 8 }}
                />
              )}
              <div style={{ marginTop: 12 }}>
                <Button icon={<LinkOutlined />} type="link" onClick={() => window.open(cashierData.paymentUrl, '_blank')}>
                  在浏览器打开支付页面
                </Button>
              </div>
            </div>

            {/* 支付说明 */}
            <Alert
              message="支付说明"
              description={
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: '#666' }}>
                  <li>使用支持 USDT 的钱包（imToken、MetaMask、 TronLink 等）扫码支付</li>
                  <li>请确保网络选择 <strong>{cashierData.network}</strong></li>
                  <li>完成支付后，系统将自动确认到账（通常 1-5 分钟）</li>
                  <li>支付完成后无需手动操作，页面将自动刷新</li>
                </ul>
              }
              type="info"
              style={{ marginBottom: 16 }}
            />

            {/* 订单号 */}
            <div style={{ textAlign: 'center', color: '#999', fontSize: 12 }}>
              订单号: <span style={{ fontFamily: 'monospace' }}>{cashierData.orderNo}</span>
            </div>

            {/* 轮询中状态 */}
            <div style={{ textAlign: 'center', marginTop: 12, color: '#1890ff', fontSize: 13 }}>
              <Spin indicator={<LoadingOutlined spin />} /> 正在等待支付确认...（自动刷新）
            </div>
          </>
        )}

        {paymentStep === 2 && cashierData && (
          <>
            {cashierData.status === 1 ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 16 }} />
                <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>充值成功！</div>
                <div style={{ color: '#666', marginBottom: 24 }}>
                  {cashierData.amountUsdt} USDT 已到账
                </div>
                <Button type="primary" onClick={() => { setCashierModal(false); loadWallet(); }}>
                  查看钱包余额
                </Button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
                <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>等待确认</div>
                <div style={{ color: '#666', marginBottom: 24 }}>
                  区块链正在确认中，请稍后刷新查看状态
                </div>
                <Space>
                  <Button onClick={() => { clearPolling(); startPollingStatus(cashierData.orderNo); setPaymentStep(1); }}>
                    刷新状态
                  </Button>
                  <Button onClick={() => setCashierModal(false)}>
                    稍后查看
                  </Button>
                </Space>
              </div>
            )}
          </>
        )}
      </Modal>

      {/* ── 传统地址模式模态框 ────────────────────────────────── */}
      <Modal
        open={addressModal}
        title="钱包充值"
        footer={null}
        onCancel={() => { setAddressModal(false); setCurrentOrder(null); }}
        width={500}
      >
        {currentOrder && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>请向以下地址转账</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1890ff' }}>
                {currentOrder.amountUsdt} USDT
              </div>
              <div style={{ color: '#999', fontSize: 13 }}>≈ ${parseFloat(currentOrder.amountUsd || currentOrder.amountUsdt).toFixed(2)} USD</div>
            </div>

            <Card style={{ background: '#f5f5f5', marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ color: '#666', fontSize: 12 }}>网络</div>
                  <div style={{ fontWeight: 500 }}>{currentOrder.network}</div>
                </Col>
                <Col span={12}>
                  <div style={{ color: '#666', fontSize: 12 }}>渠道</div>
                  <div style={{ fontWeight: 500 }}>{currentOrder.channel}</div>
                </Col>
              </Row>
            </Card>

            {currentOrder.payAddress && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <QRCode value={currentOrder.payAddress} size={180} style={{ border: '6px solid #fff' }} />
                </div>
                <div style={{
                  background: '#fff', padding: '12px 16px', borderRadius: 8,
                  border: '1px solid #d9d9d9', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', marginBottom: 16
                }}>
                  <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 12 }}>
                    {currentOrder.payAddress}
                  </span>
                  <Button type="text" icon={<CopyOutlined />} onClick={() => copyAddress(currentOrder.payAddress)}>
                    复制
                  </Button>
                </div>
              </>
            )}

            {currentOrder.expireAt && (
              <Alert
                message={`请在 ${new Date(currentOrder.expireAt).toLocaleString('zh-CN')} 前完成转账`}
                type="warning"
                style={{ marginBottom: 16 }}
              />
            )}

            <Button block size="large" onClick={() => {
              setAddressModal(false);
              setCurrentOrder(null);
              depositForm.resetFields();
            }}>
              完成
            </Button>
          </>
        )}
      </Modal>

      {/* 加载中 */}
      {depositLoading && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Card style={{ textAlign: 'center' }}>
            <Spin indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />} />
            <div style={{ marginTop: 12 }}>正在创建充值订单...</div>
          </Card>
        </div>
      )}
    </div>
  );
}