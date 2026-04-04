import db, { getDb } from './db'
import { DogPaySDK } from './channels/dogpay'

export interface DogPayBinRow {
  id: number
  channel_code: string | null
  external_bin_id: string | null
  bin_code: string
  bin_name: string
  card_brand: string | null
  issuer: string | null
  currency: string | null
  country: string | null
  status: number
  raw_json?: string | null
}

function getCardBinColumnNames(): Set<string> {
  const database = getDb()
  const pragma = database.exec('PRAGMA table_info(card_bins)')
  const columns = new Set<string>()
  const rows = pragma[0]?.values || []
  for (const row of rows) {
    if (row[1]) columns.add(String(row[1]))
  }
  return columns
}

export function ensureDogPayBinSchema() {
  const database = getDb()
  const columns = getCardBinColumnNames()

  if (!columns.has('channel_code')) {
    database.run("ALTER TABLE card_bins ADD COLUMN channel_code VARCHAR(50) DEFAULT 'manual'")
  }
  if (!columns.has('external_bin_id')) {
    database.run('ALTER TABLE card_bins ADD COLUMN external_bin_id VARCHAR(100)')
  }
  if (!columns.has('raw_json')) {
    database.run('ALTER TABLE card_bins ADD COLUMN raw_json TEXT')
  }

  database.run("UPDATE card_bins SET channel_code = 'manual' WHERE channel_code IS NULL OR channel_code = ''")
  try {
    database.run('CREATE INDEX IF NOT EXISTS idx_card_bins_channel_code ON card_bins(channel_code)')
    database.run('CREATE INDEX IF NOT EXISTS idx_card_bins_external_bin_id ON card_bins(external_bin_id)')
  } catch (err) {
    console.error('[DogPay BIN] create index failed', err)
  }
}

function normalizeBinCode(item: any, externalBinId: string) {
  const candidates = [item?.binCode, item?.bin_code, item?.bin, item?.cardBin, item?.card_bin]
  const picked = candidates.find((v) => v !== undefined && v !== null && String(v).trim() !== '')
  return String(picked || externalBinId).slice(0, 10)
}

function extractBinList(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.data?.list)) return payload.data.list
  if (Array.isArray(payload?.data?.records)) return payload.data.records
  if (Array.isArray(payload?.list)) return payload.list
  if (Array.isArray(payload?.records)) return payload.records
  return []
}

export async function syncDogPayBins(sdk: DogPaySDK) {
  ensureDogPayBinSchema()
  const payload = await sdk.getCardBins()
  const items = extractBinList(payload)

  if (!items.length) {
    throw new Error('DogPay 未返回可用 BIN 列表')
  }

  let synced = 0

  for (const item of items) {
    const externalBinId = String(item?.id || item?.channelId || item?.channel_id || item?.binId || '').trim()
    if (!externalBinId) continue

    let binCode = normalizeBinCode(item, externalBinId)
    const conflicting = db.prepare('SELECT id, external_bin_id FROM card_bins WHERE bin_code = ?').get(binCode) as any
    if (conflicting && conflicting.external_bin_id && conflicting.external_bin_id !== externalBinId) {
      binCode = externalBinId.slice(0, 10)
    }

    const binName = String(item?.binName || item?.bin_name || item?.name || item?.productName || `DOGPAY-${binCode}`)
    const cardBrand = String(item?.cardBrand || item?.card_brand || item?.brand || 'VISA')
    const issuer = String(item?.issuer || 'DogPay')
    const currency = String(item?.currency || item?.currencyCode || 'USD')
    const country = String(item?.country || item?.countryCode || 'US')
    const status = item?.status === 0 || item?.status === 'disabled' ? 0 : 1
    const rawJson = JSON.stringify(item)

    const existing = db.prepare('SELECT id FROM card_bins WHERE channel_code = ? AND external_bin_id = ?').get('dogpay', externalBinId) as any

    if (existing) {
      db.prepare(`
        UPDATE card_bins
        SET bin_code = ?, bin_name = ?, card_brand = ?, issuer = ?, currency = ?, country = ?, status = ?, raw_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(binCode, binName, cardBrand, issuer, currency, country, status, rawJson, existing.id)
    } else {
      db.prepare(`
        INSERT INTO card_bins (channel_code, external_bin_id, bin_code, bin_name, card_brand, issuer, currency, country, status, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('dogpay', externalBinId, binCode, binName, cardBrand, issuer, currency, country, status, rawJson)
    }

    synced += 1
  }

  return { synced, total: items.length }
}

export function getAvailableDogPayBins() {
  ensureDogPayBinSchema()
  return db.prepare(`
    SELECT id, channel_code, external_bin_id, bin_code, bin_name, card_brand, issuer, currency, country, status, raw_json
    FROM card_bins
    WHERE channel_code = 'dogpay' AND status = 1 AND external_bin_id IS NOT NULL
    ORDER BY id ASC
  `).all() as DogPayBinRow[]
}

export function getDogPayBinById(id: number) {
  ensureDogPayBinSchema()
  return db.prepare(`
    SELECT id, channel_code, external_bin_id, bin_code, bin_name, card_brand, issuer, currency, country, status, raw_json
    FROM card_bins
    WHERE id = ? AND channel_code = 'dogpay'
    LIMIT 1
  `).get(id) as DogPayBinRow | undefined
}
