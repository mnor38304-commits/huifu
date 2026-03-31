// 使用 Node.js 原生 https 发送邮件，绕过 nodemailer 依赖问题

interface EmailOptions {
  to: string
  subject: string
  html: string
}

async function sendWithZoho({ to, subject, html }: EmailOptions): Promise<void> {
  const smtpUser = process.env.SMTP_USER || 'admin@newkuajing.com'
  const smtpPass = process.env.SMTP_PASS || ''
  
  // 构造 MIME 邮件
  const boundary = '----=_Part_' + Date.now()
  
  const headers = [
    `From: "VCC虚拟卡系统" <${smtpUser}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `Date: ${new Date().toUTCString()}`,
  ].join('\r\n')
  
  const body = [
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(html).toString('base64'),
    `--${boundary}--`,
  ].join('\r\n')
  
  // SMTP AUTH 字符串
  const auth = Buffer.from(`${smtpUser}:${smtpPass}`).toString('base64')
  
  // 使用 curl 发送（Railway alpine 自带 curl）
  const { execSync } = await import('child_process')
  
  const cmd = [
    'curl',
    '-s',
    '--url', `smtp://smtp.zoho.com:587`,
    '--mail-from', smtpUser,
    '--mail-rcpt', to,
    '--user', `${smtpUser}:${smtpPass}`,
    '-T', '-',
  ]
  
  // 构造邮件内容通过 stdin 发送
  const mailContent = `${headers}\r\n\r\n${body}`
  
  console.log(`[Email] 正在发送至 ${to}...`)
  console.log(`[Email] SMTP: smtp.zoho.com:587, User: ${smtpUser}`)
  
  try {
    const result = execSync(`curl -s --url "smtp://smtp.zoho.com:587" --mail-from "${smtpUser}" --mail-rcpt "${to}" --user "${smtpUser}:${smtpPass}" -T -`, {
      input: mailContent,
      timeout: 15000,
      encoding: 'utf-8'
    })
    console.log(`✅ 邮件发送成功: ${to}`)
  } catch (err: any) {
    console.error(`❌ 邮件发送失败: ${err.message}`)
    // 尝试 SSL 465 端口
    try {
      console.log(`[Email] 尝试 SSL 465 端口...`)
      const result2 = execSync(`curl -s --url "smtps://smtp.zoho.com:465" --mail-from "${smtpUser}" --mail-rcpt "${to}" --user "${smtpUser}:${smtpPass}" -T -`, {
        input: mailContent,
        timeout: 15000,
        encoding: 'utf-8'
      })
      console.log(`✅ 邮件发送成功(SSL): ${to}`)
    } catch (err2: any) {
      console.error(`❌ SSL 465 也失败: ${err2.message}`)
    }
  }
}

// 同步包装版本（用于 Express 路由）
export function sendEmail(opts: EmailOptions): void {
  // 不等待结果，防止阻塞响应
  sendWithZoho(opts).catch(err => {
    console.error('邮件发送异常:', err.message)
  })
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
        <a href="https://huifu-production-20d5.up.railway.app" style="display:inline-block;background:#1890ff;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">立即登录</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
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
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
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
        <a href="https://huifu-production-20d5.up.railway.app/cards" style="display:inline-block;background:#52c41a;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看卡片</a>
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
        <a href="https://huifu-production-20d5.up.railway.app/cards" style="display:inline-block;background:#1890ff;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看卡片</a>
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
        <a href="https://huifu-production-20d5.up.railway.app/cards" style="display:inline-block;background:#ff4d4f;color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看卡片</a>
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
        <a href="https://huifu-production-20d5.up.railway.app/transactions" style="display:inline-block;background:${color};color:#fff;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:bold;">查看交易</a>
      </div>
      <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
        <p style="margin:0;">© ${new Date().getFullYear()} VCC虚拟卡系统</p>
      </div>
    </div>
  `
}
