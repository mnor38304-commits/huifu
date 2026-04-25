import db, { getDb } from './db'
import { ensureDogPayBinSchema } from './dogpay-bin-store'

export function ensureMerchantBinPermissionSchema() {
  ensureDogPayBinSchema()
  const database = getDb()
  database.run(`CREATE TABLE IF NOT EXISTS merchant_bin_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bin_id INTEGER NOT NULL,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, bin_id)
  )`)
  try {
    database.run('CREATE INDEX IF NOT EXISTS idx_mbp_user_id ON merchant_bin_permissions(user_id)')
    database.run('CREATE INDEX IF NOT EXISTS idx_mbp_bin_id ON merchant_bin_permissions(bin_id)')
  } catch (err) {
    console.error('[Merchant BIN] create index failed', err)
  }
}

export function getMerchantAssignedBinIds(userId: number) {
  ensureMerchantBinPermissionSchema()
  const rows = db.prepare('SELECT bin_id FROM merchant_bin_permissions WHERE user_id = ? AND status = 1 ORDER BY id ASC').all(userId) as any[]
  return rows.map((row) => Number(row.bin_id)).filter((id) => Number.isFinite(id))
}

export function getMerchantOpenableBins(userId: number) {
  ensureMerchantBinPermissionSchema()
  const assignedIds = getMerchantAssignedBinIds(userId)
  if (assignedIds.length > 0) {
    return db.prepare(`
      SELECT b.id, b.bin_code, b.bin_name, b.card_brand, b.issuer, b.currency, b.country, b.status,
             b.channel_code, b.external_bin_id, b.open_fee, b.monthly_fee
      FROM card_bins b
      INNER JOIN merchant_bin_permissions mbp ON mbp.bin_id = b.id
      WHERE mbp.user_id = ? AND mbp.status = 1 AND b.status = 1
        AND (b.channel_code != 'uqpay' OR json_extract(b.raw_json, '$.mode_type') = 'SINGLE')
      ORDER BY b.id ASC
    `).all(userId) as any[]
  }

  return db.prepare(`
    SELECT id, bin_code, bin_name, card_brand, issuer, currency, country, status,
           channel_code, external_bin_id, open_fee, monthly_fee
    FROM card_bins
    WHERE status = 1
      AND (channel_code != 'uqpay' OR json_extract(raw_json, '$.mode_type') = 'SINGLE')
    ORDER BY id ASC
  `).all() as any[]
}

export function saveMerchantBinAssignments(userId: number, binIds: number[]) {
  ensureMerchantBinPermissionSchema()
  const uniqueIds = Array.from(new Set((binIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)))
  db.prepare('DELETE FROM merchant_bin_permissions WHERE user_id = ?').run(userId)
  for (const binId of uniqueIds) {
    db.prepare('INSERT INTO merchant_bin_permissions (user_id, bin_id, status) VALUES (?, ?, 1)').run(userId, binId)
  }
  return { assigned: uniqueIds.length }
}

export function getMerchantBinPermissionData(userId: number) {
  ensureMerchantBinPermissionSchema()
  const assignedBinIds = getMerchantAssignedBinIds(userId)
  const allBins = db.prepare(`
    SELECT id, bin_code, bin_name, card_brand, issuer, currency, country, status,
           channel_code, external_bin_id
    FROM card_bins
    ORDER BY status DESC, id ASC
  `).all() as any[]

  return {
    restricted: assignedBinIds.length > 0,
    assignedBinIds,
    allBins,
  }
}
