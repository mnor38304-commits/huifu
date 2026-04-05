import db from './db'

export type VerificationChannel = 'phone' | 'email'

interface VerificationCodeRecord {
  id: number
  account: string
  channel: VerificationChannel
  code: string
  expires_at: number
  created_at: string
}

let initialized = false

function ensureTable() {
  if (initialized) return

  db.prepare(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account VARCHAR(100) NOT NULL,
      channel VARCHAR(20) NOT NULL,
      code VARCHAR(10) NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run()

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_verification_codes_account_channel
    ON verification_codes(account, channel)
  `).run()

  initialized = true
}

export function saveVerificationCode(account: string, channel: VerificationChannel, code: string, ttlMs: number) {
  ensureTable()
  db.prepare('DELETE FROM verification_codes WHERE account = ? AND channel = ?').run(account, channel)
  db.prepare(`
    INSERT INTO verification_codes (account, channel, code, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(account, channel, code, Date.now() + ttlMs)
}

export function getVerificationCode(account: string, channel: VerificationChannel): VerificationCodeRecord | undefined {
  ensureTable()
  cleanupExpiredVerificationCodes()
  return db.prepare(`
    SELECT id, account, channel, code, expires_at, created_at
    FROM verification_codes
    WHERE account = ? AND channel = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(account, channel) as VerificationCodeRecord | undefined
}

export function deleteVerificationCode(account: string, channel: VerificationChannel) {
  ensureTable()
  db.prepare('DELETE FROM verification_codes WHERE account = ? AND channel = ?').run(account, channel)
}

export function cleanupExpiredVerificationCodes() {
  ensureTable()
  db.prepare('DELETE FROM verification_codes WHERE expires_at < ?').run(Date.now())
}
