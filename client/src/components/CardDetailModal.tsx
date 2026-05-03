import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal, Descriptions, Tag, Tabs, Table, DatePicker, Select, Input,
  Button, Space, Spin, message, Empty, Row, Col, Tooltip,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, EyeOutlined, CopyOutlined,
} from '@ant-design/icons';
import VirtualCard from './VirtualCard';
import { getCardEnhancedDetail, getCardTransactions, getCardOperations, revealCard, getPanToken, updateCardholderEmail } from '../services/api';

const { RangePicker } = DatePicker;
const { Option } = Select;

interface CardDetailModalProps {
  cardId: number | null;
  visible: boolean;
  onClose: () => void;
}

const statusColorMap: Record<number, string> = {
  0: 'default', 1: 'green', 2: 'orange', 3: 'red', 4: 'default',
};
const statusTextMap: Record<number, string> = {
  0: '待激活', 1: '可用', 2: '冻结', 3: '已过期', 4: '已注销',
};

const CardDetailModal: React.FC<CardDetailModalProps> = ({ cardId, visible, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [isFlipped, setIsFlipped] = useState(false);

  // Reveal state
  const [revealedCardNo, setRevealedCardNo] = useState<string | null>(null);
  const [revealedExpiry, setRevealedExpiry] = useState<string | null>(null);
  const [revealedCvv, setRevealedCvv] = useState<string | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Secure iFrame state
  const [secureIframeVisible, setSecureIframeVisible] = useState(false);
  const [secureIframeUrl, setSecureIframeUrl] = useState<string | null>(null);
  const [secureIframeLoading, setSecureIframeLoading] = useState(false);
  const [secureIframeExpiresAt, setSecureIframeExpiresAt] = useState<string | null>(null);

  // Transaction state
  const [txnTabKey, setTxnTabKey] = useState('transactions');
  const [txnLoading, setTxnLoading] = useState(false);
  const [txns, setTxns] = useState<any[]>([]);
  const [txnTotal, setTxnTotal] = useState(0);
  const [txnPage, setTxnPage] = useState(1);
  const [txnPageSize] = useState(10);
  const [txnFilters, setTxnFilters] = useState({
    startDate: '',
    endDate: '',
    type: '',
    status: '',
    keyword: '',
  });

  // Cardholder email edit state
  const [emailEditVisible, setEmailEditVisible] = useState(false);
  const [emailEditValue, setEmailEditValue] = useState('');
  const [emailEditLoading, setEmailEditLoading] = useState(false);

  // Operation state
  const [opsLoading, setOpsLoading] = useState(false);
  const [ops, setOps] = useState<any[]>([]);
  const [opsTotal, setOpsTotal] = useState(0);
  const [opsPage, setOpsPage] = useState(1);
  const [opsPageSize] = useState(10);

  // ── Load card detail ──
  const loadDetail = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const res = await getCardEnhancedDetail(cardId);
      if (res.code === 0) {
        setDetail(res.data);
      } else {
        message.error(res.message || '加载卡片详情失败');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载卡片详情失败');
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  // ── Load transactions ──
  const loadTransactions = useCallback(async (page = 1) => {
    if (!cardId) return;
    setTxnLoading(true);
    try {
      const params: any = { page, pageSize: txnPageSize };
      if (txnFilters.startDate) params.startDate = txnFilters.startDate;
      if (txnFilters.endDate) params.endDate = txnFilters.endDate;
      if (txnFilters.type) params.type = txnFilters.type;
      if (txnFilters.status !== '') params.status = txnFilters.status;
      if (txnFilters.keyword) params.keyword = txnFilters.keyword;

      const res = await getCardTransactions(cardId, params);
      if (res.code === 0) {
        setTxns(res.data?.list || []);
        setTxnTotal(res.data?.total || 0);
        setTxnPage(page);
      } else {
        message.error(res.message || '加载交易明细失败');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载交易明细失败');
    } finally {
      setTxnLoading(false);
    }
  }, [cardId, txnFilters, txnPageSize]);

  // ── Load operations ──
  const loadOperations = useCallback(async (page = 1) => {
    if (!cardId) return;
    setOpsLoading(true);
    try {
      const res = await getCardOperations(cardId, { page, pageSize: opsPageSize });
      if (res.code === 0) {
        setOps(res.data?.list || []);
        setOpsTotal(res.data?.total || 0);
        setOpsPage(page);
      } else {
        message.error(res.message || '加载操作记录失败');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载操作记录失败');
    } finally {
      setOpsLoading(false);
    }
  }, [cardId, opsPageSize]);

  // ── Initial load ──
  useEffect(() => {
    if (visible && cardId) {
      resetReveal();
      setTxnTabKey('transactions');
      loadDetail();
      loadTransactions(1);
    }
  }, [visible, cardId, loadDetail, loadTransactions]);

  // ── Cleanup on close ──
  const handleClose = () => {
    resetReveal();
    setSecureIframeVisible(false);
    setSecureIframeUrl(null);
    setSecureIframeExpiresAt(null);
    setDetail(null);
    setTxns([]);
    setOps([]);
    onClose();
  };

  // ── Reveal handler ──
  const resetReveal = () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    setRevealedCardNo(null);
    setRevealedExpiry(null);
    setRevealedCvv(null);
  };

  const handleReveal = async () => {
    if (!cardId) return;
    setRevealLoading(true);
    try {
      const res = await revealCard(cardId);
      if (res.code === 0 && res.data) {
        if (res.data.mode === 'secure_iframe') {
          // UQPay Secure iFrame 模式：自动请求 PAN Token 并打开 iFrame
          setSecureIframeLoading(true);
          try {
            const tokenRes = await getPanToken(cardId);
            if (tokenRes.code === 0 && tokenRes.data?.iframeUrl) {
              setSecureIframeUrl(tokenRes.data.iframeUrl);
              setSecureIframeExpiresAt(tokenRes.data.expiresAt || null);
              setSecureIframeVisible(true);
            } else {
              message.error(tokenRes.message || '获取安全卡信息页面失败');
            }
          } catch (err: any) {
            message.error(err?.response?.data?.message || '获取安全卡信息页面失败');
          } finally {
            setSecureIframeLoading(false);
          }
          return;
        }
        setRevealedCardNo(res.data.cardNo || null);
        setRevealedExpiry(res.data.expireDate || null);
        setRevealedCvv(res.data.cvv || null);
        message.success('已获取完整卡信息，60秒后自动隐藏');

        // 60s auto-revert
        if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
        revealTimerRef.current = setTimeout(() => {
          resetReveal();
          message.info('卡面信息已自动隐藏');
        }, 60000);
      } else {
        message.error(res.message || '查看卡信息失败');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '查看卡信息失败');
    } finally {
      setRevealLoading(false);
    }
  };

  // ── Copy handlers ──
  const copyText = async (text: string, label: string) => {
    if (!text || text.includes('*')) {
      message.warning(`${label}未显示，无法复制`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label}已复制`);
    } catch {
      message.error(`${label}复制失败，请手动复制`);
    }
  };

  const copyAllCardInfo = async () => {
    if (!revealedCardNo || !revealedExpiry || !revealedCvv) {
      message.warning('请先查看完整卡信息');
      return;
    }
    const text = [
      `卡号：${revealedCardNo}`,
      `有效期：${revealedExpiry}`,
      `CVV：${revealedCvv}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      message.success('卡号、有效期、CVV 已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  };

  // ── Filter handlers ──
  const handleDateChange = (_: any, dateStrings: [string, string]) => {
    setTxnFilters(prev => ({ ...prev, startDate: dateStrings[0] || '', endDate: dateStrings[1] || '' }));
  };

  const handleFilterSearch = () => {
    loadTransactions(1);
  };

  const handleFilterReset = () => {
    setTxnFilters({ startDate: '', endDate: '', type: '', status: '', keyword: '' });
    setTimeout(() => loadTransactions(1), 0);
  };

  // ── Tab change handler ──
  const handleTabChange = (key: string) => {
    setTxnTabKey(key);
    if (key === 'operations') {
      loadOperations(1);
    }
  };

  // ── Card number display ──
  const displayCardNo = revealedCardNo || detail?.cardNumberMasked || '**** **** **** ****';
  const displayExpiry = revealedExpiry || detail?.expiryMasked || '**/**';
  const displayCvv = revealedCvv || detail?.cvvMasked || '***';
  const isRevealed = !!revealedCardNo;

  // ── Transaction columns ──
  const txnColumns = [
    { title: '交易日期', dataIndex: 'transactionDate', key: 'transactionDate', width: 160 },
    { title: '交易类型', dataIndex: 'transactionType', key: 'transactionType', width: 100 },
    {
      title: '交易金额', dataIndex: 'amount', key: 'amount', width: 120,
      render: (val: string, record: any) => `${val} ${record.currency || 'USD'}`,
    },
    {
      title: '交易状态', dataIndex: 'statusText', key: 'status', width: 90,
      render: (text: string, record: any) => {
        const colorMap: Record<string, string> = { '成功': 'green', '失败': 'red', '处理中': 'blue', '撤销': 'orange' };
        return <Tag color={colorMap[text] || 'default'}>{text}</Tag>;
      },
    },
    { title: '交易流水号', dataIndex: 'transactionNo', key: 'transactionNo', width: 200 },
    { title: '商户名称', dataIndex: 'merchantName', key: 'merchantName', width: 150, ellipsis: true },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true },
  ];

  // ── Operation columns ──
  const opColumns = [
    { title: '操作时间', dataIndex: 'createdAt', key: 'createdAt', width: 160 },
    { title: '操作类型', dataIndex: 'operationType', key: 'operationType', width: 100 },
    { title: '操作人', dataIndex: 'operator', key: 'operator', width: 100 },
    { title: '操作结果', dataIndex: 'result', key: 'result', width: 90 },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true },
  ];

  return (
    <>
      <Modal
      title={
        <Space>
          <span style={{ fontSize: 16, fontWeight: 600 }}>卡片详情</span>
          {detail && (
            <Tag color={statusColorMap[detail.status] || 'default'}>
              {detail.statusText}
            </Tag>
          )}
        </Space>
      }
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={1000}
      destroyOnClose
    >
      <Spin spinning={loading}>
        {detail && (
          <>
            {/* Top section: Virtual Card + Info */}
            <Row gutter={24} style={{ marginBottom: 24 }}>
              <Col xs={24} sm={10}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <VirtualCard
                    cardNumberMasked={displayCardNo}
                    expiryMasked={displayExpiry}
                    cvvMasked={displayCvv}
                    isFlipped={isFlipped}
                  />
                </div>
                <div style={{ textAlign: 'center', marginTop: 8 }}>
                  <Space>
                    <Button
                      size="small"
                      icon={isFlipped ? <span>🔄</span> : <span>🔄</span>}
                      onClick={() => setIsFlipped(!isFlipped)}
                    >
                      翻转卡片
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      icon={<EyeOutlined />}
                      loading={revealLoading}
                      onClick={handleReveal}
                    >
                      {isRevealed ? '已显示' : '查看卡信息'}
                    </Button>
                  </Space>
                </div>
                {/* ── Copy buttons (only when revealed) ── */}
                {isRevealed && (
                  <div style={{ textAlign: 'center', marginTop: 8 }}>
                    <Space wrap>
                      <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(revealedCardNo || '', '卡号')}>
                        复制卡号
                      </Button>
                      <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(revealedExpiry || '', '有效期')}>
                        复制有效期
                      </Button>
                      <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(revealedCvv || '', 'CVV')}>
                        复制 CVV
                      </Button>
                      <Button size="small" type="primary" icon={<CopyOutlined />} onClick={copyAllCardInfo}>
                        一键复制全部
                      </Button>
                    </Space>
                  </div>
                )}
              </Col>
              <Col xs={24} sm={14}>
                <Descriptions column={3} size="small" bordered style={{ marginTop: 4 }}>
                  <Descriptions.Item label="卡片备注" span={3}>
                    <strong>{detail.remark}</strong>
                    <Tooltip title="编辑功能即将开放">
                      <Button type="link" size="small" style={{ padding: '0 4px', marginLeft: 8 }}>
                        ✏️
                      </Button>
                    </Tooltip>
                  </Descriptions.Item>
                  <Descriptions.Item label="卡号" span={2}>
                    <span style={{ fontFamily: "'Courier New', monospace", fontSize: 15, fontWeight: 600 }}>
                      {displayCardNo}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="卡ID">
                    <Tooltip title={detail.cardId || '-'}>
                      <span style={{ fontSize: 12 }}>{(detail.cardId || '-').slice(0, 12)}...</span>
                    </Tooltip>
                  </Descriptions.Item>
                  <Descriptions.Item label="有效期">
                    <span style={{ fontFamily: "'Courier New', monospace", fontWeight: 600 }}>
                      {displayExpiry}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="累计消费">
                    <span style={{ fontWeight: 600, color: '#1677ff' }}>
                      ${Number(detail.totalSpendAmount).toFixed(2)}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="累计转入金额">
                    <span style={{ fontWeight: 600, color: '#52c41a' }}>
                      ${Number(detail.totalTopupAmount).toFixed(2)}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="CVV">
                    <span style={{ fontFamily: "'Courier New', monospace", fontWeight: 600, letterSpacing: 2 }}>
                      {displayCvv}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="失败订单数">
                    <span style={{ color: (detail.failedTxnCount || 0) > 0 ? '#ff4d4f' : '#999' }}>
                      {detail.failedTxnCount || 0}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="持卡人邮箱" span={2}>
                    <span>{detail.cardholderEmail || '-'}</span>
                    {detail.cardholderEmailEditable && (
                      <Button type="link" size="small" style={{ marginLeft: 8 }}
                        onClick={() => { setEmailEditValue(detail.cardholderEmail || ''); setEmailEditVisible(true) }}>
                        编辑
                      </Button>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="发卡地">{detail.issueCountry}</Descriptions.Item>
                  <Descriptions.Item label="账单地址" span={3}>{detail.billingAddress || '—'}</Descriptions.Item>
                </Descriptions>
              </Col>
            </Row>

            {/* Bottom section: Tabs */}
            <Tabs activeKey={txnTabKey} onChange={handleTabChange} type="card">
              {/* Tab 1: Transactions */}
              <Tabs.TabPane tab="交易明细" key="transactions">
                {/* Filters */}
                <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
                  <Col>
                    <Input
                      placeholder="搜索交易流水号"
                      prefix={<SearchOutlined />}
                      style={{ width: 180 }}
                      value={txnFilters.keyword}
                      onChange={e => setTxnFilters(prev => ({ ...prev, keyword: e.target.value }))}
                      onPressEnter={handleFilterSearch}
                      allowClear
                    />
                  </Col>
                  <Col>
                    <RangePicker
                      style={{ width: 220 }}
                      onChange={handleDateChange}
                    />
                  </Col>
                  <Col>
                    <Select
                      placeholder="交易类型"
                      style={{ width: 120 }}
                      value={txnFilters.type || undefined}
                      onChange={val => setTxnFilters(prev => ({ ...prev, type: val || '' }))}
                      allowClear
                    >
                      <Option value="">全部</Option>
                      <Option value="TOPUP">充值</Option>
                      <Option value="CONSUME">消费</Option>
                      <Option value="AUTH">授权</Option>
                      <Option value="REFUND">退款</Option>
                      <Option value="CANCEL_REFUND">退款</Option>
                      <Option value="FEE">手续费</Option>
                    </Select>
                  </Col>
                  <Col>
                    <Select
                      placeholder="交易状态"
                      style={{ width: 120 }}
                      value={txnFilters.status}
                      onChange={val => setTxnFilters(prev => ({ ...prev, status: val }))}
                      allowClear
                    >
                      <Option value="">全部</Option>
                      <Option value="1">成功</Option>
                      <Option value="2">失败</Option>
                      <Option value="0">处理中</Option>
                      <Option value="3">撤销</Option>
                    </Select>
                  </Col>
                  <Col>
                    <Space>
                      <Button type="primary" icon={<SearchOutlined />} onClick={handleFilterSearch}>
                        查询
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={handleFilterReset}>
                        重置
                      </Button>
                    </Space>
                  </Col>
                </Row>

                {/* Table */}
                <Table
                  columns={txnColumns}
                  dataSource={txns}
                  rowKey="id"
                  loading={txnLoading}
                  pagination={{
                    current: txnPage,
                    pageSize: txnPageSize,
                    total: txnTotal,
                    onChange: loadTransactions,
                    showTotal: (t) => `共 ${t} 条`,
                  }}
                  locale={{ emptyText: <Empty description="暂无交易数据" /> }}
                  scroll={{ x: 800 }}
                  size="small"
                />
              </Tabs.TabPane>

              {/* Tab 2: Operations */}
              <Tabs.TabPane tab="操作记录" key="operations">
                <Table
                  columns={opColumns}
                  dataSource={ops}
                  rowKey={(_, idx) => String(idx)}
                  loading={opsLoading}
                  pagination={{
                    current: opsPage,
                    pageSize: opsPageSize,
                    total: opsTotal,
                    onChange: loadOperations,
                    showTotal: (t) => `共 ${t} 条`,
                  }}
                  locale={{ emptyText: <Empty description="暂无操作记录" /> }}
                  size="small"
                />
              </Tabs.TabPane>
            </Tabs>
          </>
        )}
      </Spin>
    </Modal>

      {/* ── 安全卡面 Modal ── */}
      <Modal
        title="安全查看卡信息"
        open={secureIframeVisible}
        onCancel={() => {
          setSecureIframeVisible(false);
          setSecureIframeUrl(null);
          setSecureIframeExpiresAt(null);
        }}
        footer={null}
        width={700}
        destroyOnClose
      >
        <Spin spinning={secureIframeLoading}>
          {secureIframeUrl && (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="完整卡号、有效期和 CVV 在安全卡面页面中展示。出于安全合规要求，父页面不能读取或复制完整卡信息。如需复制，请在安全卡面页面内操作。"
              />
              {secureIframeExpiresAt && (
                <p style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                  Token 有效期至: {new Date(secureIframeExpiresAt).toLocaleString('zh-CN')}
                </p>
              )}
              <iframe
                src={secureIframeUrl}
                title="Secure Card Information"
                style={{
                  width: '100%',
                  height: 420,
                  border: '1px solid #eee',
                  borderRadius: 8,
                }}
                sandbox="allow-scripts allow-forms allow-same-origin"
                referrerPolicy="no-referrer"
              />
            </>
          )}
        </Spin>
      </Modal>

      {/* ── 修改持卡人邮箱弹窗 ── */}
      <Modal
        title="修改持卡人邮箱"
        open={emailEditVisible}
        onCancel={() => setEmailEditVisible(false)}
        onOk={async () => {
          if (!cardId || !emailEditValue) { message.warning('请输入邮箱'); return }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEditValue)) { message.warning('邮箱格式不正确'); return }
          setEmailEditLoading(true)
          try {
            const res = await updateCardholderEmail(cardId, emailEditValue.trim())
            if (res.code === 0) {
              message.success('邮箱修改成功')
              setEmailEditVisible(false)
              loadDetail()
            } else {
              message.error(res.message)
            }
          } catch (err: any) {
            message.error(err?.response?.data?.message || '修改失败')
          } finally {
            setEmailEditLoading(false)
          }
        }}
        confirmLoading={emailEditLoading}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>新邮箱地址：</div>
        <Input placeholder="请输入新邮箱" value={emailEditValue} onChange={e => setEmailEditValue(e.target.value)} type="email" />
      </Modal>
    </>
  );
};

export default CardDetailModal;
