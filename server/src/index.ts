import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import bcrypt from 'bcryptjs';
import db, { initDatabase } from './db';

// 商户端路由
import authRoutes from './routes/auth-resend-v2';
import kycRoutes from './routes/kyc';
import cardRoutes from './routes/cards';
import transactionRoutes from './routes/transactions';
import billRoutes from './routes/bills';
import noticeRoutes from './routes/notices';

// 管理员路由
import adminAuthRoutes from './routes/admin-auth';
import adminDashboardRoutes from './routes/admin-dashboard';
import adminMerchantsRoutes from './routes/admin-merchants';
import adminCardsRoutes from './routes/admin-cards';
import adminUsdtRoutes from './routes/admin-usdt';
import adminOpsRoutes from './routes/admin-ops';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── 商户端 API ────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/kyc', kycRoutes);
app.use('/api/v1/cards', cardRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/bills', billRoutes);
app.use('/api/v1/notices', noticeRoutes);

// ── 管理员 API ────────────────────────────────────────────────
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/merchants', adminMerchantsRoutes);
app.use('/api/admin/cards', adminCardsRoutes);
app.use('/api/admin/usdt', adminUsdtRoutes);
app.use('/api/admin/ops', adminOpsRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ code: 500, message: 'Server error', timestamp: Date.now() });
});

async function start() {
  await initDatabase();



  // 初始化默认 BIN
  const binCount = (db.prepare('SELECT COUNT(*) as c FROM card_bins').get() as any).c;
  if (binCount === 0) {
    const bins = [
      ['411111', 'Visa Standard USD', 'VISA', 'Demo Bank', 'USD', 'US', 0, 0.015, 0, 0.015, 1, 0.1, 0.5, 0, 0, 1.0],
      ['522222', 'Mastercard Premium', 'MC', 'Demo Bank', 'USD', 'US', 1, 0.012, 0, 0.012, 1, 0.1, 0.5, 0, 0, 1.5],
      ['433333', 'Visa Business', 'VISA', 'Business Bank', 'USD', 'US', 2, 0.018, 0.5, 0.018, 1, 0.15, 0.5, 0.1, 0, 2.0],
    ];
    bins.forEach(b => db.prepare(`INSERT INTO card_bins (bin_code,bin_name,card_brand,issuer,currency,country,open_fee,topup_fee_rate,topup_fee_min,cross_border_fee_rate,small_txn_threshold,small_txn_fee,decline_fee,auth_fee,refund_fee_rate,monthly_fee) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...b));
    console.log('✅ Default BINs created');
  }

  // 初始化默认渠道
  const channelCount = (db.prepare('SELECT COUNT(*) as c FROM card_channels').get() as any).c;
  if (channelCount === 0) {
    db.prepare(`INSERT INTO card_channels (channel_code,channel_name,api_base_url,status,config_json) VALUES (?,?,?,1,?)`).run('AIRWALLEX', '空中云汇', 'https://api.airwallex.com', '{"version":"v1"}');
    db.prepare(`INSERT INTO card_channels (channel_code,channel_name,api_base_url,status,config_json) VALUES (?,?,?,1,?)`).run('PHOTON', '光子易', 'https://api.photon.com', '{"version":"v2"}');
    db.prepare(`INSERT INTO card_channels (channel_code,channel_name,api_base_url,status,config_json) VALUES (?,?,?,0,?)`).run('CUSTOM', '自定义渠道', 'https://api.example.com', '{}');
    console.log('✅ Default channels created');
  }

  app.listen(PORT, () => {
    console.log(`🚀 VCC Server: http://localhost:${PORT}`);
    console.log(`🔐 Admin API:  http://localhost:${PORT}/api/admin`);
  });
}

start().catch(e => { console.error(e); process.exit(1); });
