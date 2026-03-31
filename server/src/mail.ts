import nodemailer from 'nodemailer'

// Zoho SMTP 配置
const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,  // 使用 SSL
  auth: {
    user: process.env.SMTP_USER || 'admin@newkuajing.com',
    pass: process.env.SMTP_PASS || ''
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000
})

interface EmailOptions {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: EmailOptions) {
  try {
    console.log(`[Email] 正在发送至 ${to}...`)
    console.log(`[Email] SMTP配置: host=smtp.zoho.com, port=465, user=${process.env.SMTP_USER}`)
    
    const result = await transporter.sendMail({
      from: `"VCC虚拟卡系统" <${process.env.SMTP_USER || 'admin@newkuajing.com'}>`,
      to,
      subject,
      html
    })
    console.log(`✅ 邮件已发送至: ${to}, messageId: ${result.messageId}`)
    return result
  } catch (err: any) {
    console.error(`❌ 邮件发送失败:`, err.message)
    console.error(`   错误码: ${err.code}`)
    console.error(`   响应: ${err.response}`)
    return null
  }
}

// ── 邮件模板 ──────────────────────────────────────────────────

export function regSuccessTemplate(userNo: string, phone: string) {
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
        <a href="${process.env.CLIENT_URL || 'https://huifu-production-20d5.up.railway.app'}" style="display:inline-block;background:#1890ff;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">立即登录</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统 · 请勿回复此邮件</p>
      </div>
    </div>
  `
}

export function passwordResetTemplate(code: string) {
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
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统 · 请勿回复此邮件</p>
      </div>
    </div>
  `
}

export function cardOpenedTemplate(cardNo: string, cardName: string, creditLimit: number) {
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
        <a href="${process.env.CLIENT_URL || 'https://huifu-production-20d5.up.railway.app/cards'}" style="display:inline-block;background:#52c41a;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看卡片</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `
}

export function topupSuccessTemplate(cardNo: string, amount: number, balance: number) {
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
        <a href="${process.env.CLIENT_URL || 'https://huifu-production-20d5.up.railway.app/cards'}" style="display:inline-block;background:#1890ff;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看卡片</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `
}

export function transactionDeclinedTemplate(cardNo: string, merchant: string, amount: number, reason: string) {
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
        <a href="${process.env.CLIENT_URL || 'https://huifu-production-20d5.up.railway.app/cards'}" style="display:inline-block;background:#ff4d4f;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看卡片</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `
}

export function balanceChangeTemplate(cardNo: string, type: string, amount: number, balance: number) {
  const color = type === '消费' ? '#ff4d4f' : type === '退款' ? '#52c41a' : '#1890ff'
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
        <a href="${process.env.CLIENT_URL || 'https://huifu-production-20d5.up.railway.app/transactions'}" style="display:inline-block;background:${color};color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看交易</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `
}
