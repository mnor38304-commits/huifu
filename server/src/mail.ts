import nodemailer from 'nodemailer';
import { Resend } from 'resend';

let cachedTransporter: nodemailer.Transporter | null = null;
let cachedTransportKey = '';

function getClientUrl(): string {
  return process.env.CLIENT_URL || 'http://localhost:5173';
}

// ── Resend ─────────────────────────────────────────────────────────────────
async function sendViaResend({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from   = process.env.RESEND_FROM?.trim() || 'Cardgolink <noreply@cardgolink.com>';
  if (!apiKey) throw new Error('RESEND_API_KEY 未配置');
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    console.error('❌ Resend 邮件发送失败:', error);
    throw new Error(error.message || '邮件发送失败');
  }
  console.log(`✅ 邮件发送成功 (Resend): ${to} (${data?.id})`);
}

// ── SMTP fallback ──────────────────────────────────────────────────────────
function getMailConfig() {
  const host   = process.env.SMTP_HOST?.trim();
  const user   = process.env.SMTP_USER?.trim();
  const pass   = process.env.SMTP_PASS?.trim();
  const from   = (process.env.SMTP_FROM || user || '').trim();
  const fromName = (process.env.SMTP_FROM_NAME || 'VCC虚拟卡系统').trim();
  const port   = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || String(port === 465)).toLowerCase() === 'true';
  if (!host || !user || !pass || !from) {
    throw new Error('SMTP 未配置完整，请设置 SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASS、SMTP_FROM');
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('SMTP_PORT 配置无效');
  }
  return { host, port, secure, user, pass, from, fromName };
}

function getTransporter(config: ReturnType<typeof getMailConfig>): nodemailer.Transporter {
  const transportKey = [config.host, config.port, config.secure, config.user].join('|');
  if (!cachedTransporter || cachedTransportKey !== transportKey) {
    cachedTransporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    });
    cachedTransportKey = transportKey;
  }
  return cachedTransporter;
}

async function sendViaSMTP({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void> {
  const config = getMailConfig();
  const transporter = getTransporter(config);
  const info = await transporter.sendMail({
    from: `"${config.fromName}" <${config.from}>`,
    to, subject, html
  });
  console.log(`✅ 邮件发送成功 (SMTP): ${to} (${info.messageId})`);
}

// ── 统一入口 ─────────────────────────────────────────────────────────────────
export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void> {
  // 优先 Resend
  if (process.env.RESEND_API_KEY?.trim()) {
    await sendViaResend({ to, subject, html });
  } else {
    // fallback SMTP
    await sendViaSMTP({ to, subject, html });
  }
}

export function verificationCodeTemplate(code: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1890ff;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;">📧 邮箱验证</h1>
      </div>
      <div style="padding:32px;background:#fafafa;">
        <p style="font-size:16px;">您好！</p>
        <p style="font-size:16px;">您的验证码是：</p>
        <div style="background:#fff;padding:24px;border-radius:8px;text-align:center;margin:20px 0;border:2px dashed #1890ff;">
          <p style="font-size:36px;font-weight:bold;color:#1890ff;margin:0;letter-spacing:8px;">${code}</p>
        </div>
        <p style="font-size:14px;color:#999;">验证码 <strong>5 分钟内有效</strong>，如非本人操作请忽略此邮件。</p>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `;
}

export function regSuccessTemplate(userNo: string, phone: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1890ff;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;">🎉 注册成功</h1>
      </div>
      <div style="padding:32px;background:#fafafa;">
        <p style="font-size:16px;">您好！</p>
        <p style="font-size:16px;">恭喜您成功注册 <strong>VCC 虚拟卡系统</strong>！</p>
        <div style="background:#fff;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #e8e8e8;">
          <p style="margin:0;"><strong>用户编号：</strong>${userNo}</p>
          <p style="margin:8px 0 0;"><strong>注册手机：</strong>${phone}</p>
        </div>
        <p style="font-size:14px;color:#666;">现在您可以登录系统，申请虚拟卡，享受便捷的跨境支付服务。</p>
        <a href="${getClientUrl()}" style="display:inline-block;background:#1890ff;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">立即登录</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `;
}

export function passwordResetTemplate(code: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#faad14;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;">🔐 密码重置</h1>
      </div>
      <div style="padding:32px;background:#fafafa;">
        <p style="font-size:16px;">您好！</p>
        <p style="font-size:16px;">您申请了密码重置，请使用以下验证码：</p>
        <div style="background:#fff;padding:24px;border-radius:8px;text-align:center;margin:20px 0;border:2px dashed #faad14;">
          <p style="font-size:14px;color:#666;margin:0 0 8px;">验证码</p>
          <p style="font-size:36px;font-weight:bold;color:#faad14;margin:0;letter-spacing:8px;">${code}</p>
        </div>
        <p style="font-size:14px;color:#999;">验证码 <strong>5 分钟内有效</strong>，如非本人操作请忽略此邮件。</p>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `;
}

export function cardOpenedTemplate(cardNo: string, cardName: string, creditLimit: number): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#52c41a;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;">💳 开卡成功</h1>
      </div>
      <div style="padding:32px;background:#fafafa;">
        <p style="font-size:16px;">您好！</p>
        <p style="font-size:16px;">您的虚拟卡已成功开立！</p>
        <div style="background:#fff;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #e8e8e8;">
          <p style="margin:0;"><strong>卡号：</strong>${cardNo}</p>
          <p style="margin:8px 0 0;"><strong>卡名：</strong>${cardName}</p>
          <p style="margin:8px 0 0;"><strong>额度：</strong>$${creditLimit.toFixed(2)} USD</p>
        </div>
        <a href="${getClientUrl()}/cards" style="display:inline-block;background:#52c41a;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看卡片</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `;
}

export function topupSuccessTemplate(cardNo: string, amount: number, balance: number): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1890ff;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;">💰 充值成功</h1>
      </div>
      <div style="padding:32px;background:#fafafa;">
        <p style="font-size:16px;">您好！</p>
        <p style="font-size:16px;">您的虚拟卡充值成功！</p>
        <div style="background:#fff;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #e8e8e8;">
          <p style="margin:0;"><strong>卡号：</strong>${cardNo}</p>
          <p style="margin:8px 0 0;"><strong>充值金额：</strong><span style="color:#52c41a;font-size:20px;font-weight:bold;">+$${amount.toFixed(2)} USD</span></p>
          <p style="margin:8px 0 0;"><strong>当前余额：</strong><span style="color:#1890ff;font-weight:bold;">$${balance.toFixed(2)} USD</span></p>
        </div>
        <a href="${getClientUrl()}/cards" style="display:inline-block;background:#1890ff;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看卡片</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `;
}

export function transactionDeclinedTemplate(cardNo: string, merchant: string, amount: number, reason: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#ff4d4f;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;">⚠️ 交易失败</h1>
      </div>
      <div style="padding:32px;background:#fafafa;">
        <p style="font-size:16px;">您好！</p>
        <p style="font-size:16px;">您的虚拟卡有一笔交易被拒绝：</p>
        <div style="background:#fff;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #ff4d4f;">
          <p style="margin:0;"><strong>卡号：</strong>${cardNo}</p>
          <p style="margin:8px 0 0;"><strong>商户：</strong>${merchant}</p>
          <p style="margin:8px 0 0;"><strong>金额：</strong>$${amount.toFixed(2)} USD</p>
          <p style="margin:8px 0 0;color:#ff4d4f;"><strong>原因：</strong>${reason}</p>
        </div>
        <a href="${getClientUrl()}/cards" style="display:inline-block;background:#ff4d4f;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看卡片</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `;
}

export function balanceChangeTemplate(cardNo: string, type: string, amount: number, balance: number): string {
  const color = type === '消费' ? '#ff4d4f' : type === '退款' ? '#52c41a' : '#1890ff';
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:${color};padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;">💳 余额变动</h1>
      </div>
      <div style="padding:32px;background:#fafafa;">
        <p style="font-size:16px;">您好！</p>
        <p style="font-size:16px;">您的虚拟卡余额发生变动：</p>
        <div style="background:#fff;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #e8e8e8;">
          <p style="margin:0;"><strong>卡号：</strong>${cardNo}</p>
          <p style="margin:8px 0 0;"><strong>变动类型：</strong>${type}</p>
          <p style="margin:8px 0 0;"><strong>变动金额：</strong><span style="color:${color};font-weight:bold;">${amount > 0 ? '+' : ''}$${Math.abs(amount).toFixed(2)} USD</span></p>
          <p style="margin:8px 0 0;"><strong>当前余额：</strong><span style="color:#1890ff;font-weight:bold;">$${balance.toFixed(2)} USD</span></p>
        </div>
        <a href="${getClientUrl()}/transactions" style="display:inline-block;background:${color};color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看交易</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `;
}
