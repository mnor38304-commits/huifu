import { Resend } from 'resend'
export { verificationCodeTemplate, regSuccessTemplate, passwordResetTemplate, cardOpenedTemplate, topupSuccessTemplate, transactionDeclinedTemplate, balanceChangeTemplate } from './mail'

interface EmailOptions {
  to: string
  subject: string
  html: string
}

let cachedResend: Resend | null = null
let cachedApiKey = ''

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim()

  if (!apiKey) {
    throw new Error('RESEND_API_KEY 未配置')
  }

  if (!cachedResend || cachedApiKey !== apiKey) {
    cachedResend = new Resend(apiKey)
    cachedApiKey = apiKey
  }

  return cachedResend
}

function getFromAddress() {
  return (process.env.RESEND_FROM || 'VCC虚拟卡系统 <noreply@cardgolink.com>').trim()
}

export async function sendEmail({ to, subject, html }: EmailOptions): Promise<void> {
  const resend = getResendClient()
  const from = getFromAddress()

  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    html,
  })

  if (error) {
    console.error(`❌ 邮件发送失败: ${to}`, error)
    throw new Error(error.message || 'Resend 邮件发送失败')
  }

  console.log(`✅ 邮件发送成功: ${to} (${data?.id || 'no-id'})`)
}
