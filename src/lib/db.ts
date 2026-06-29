import { neon } from '@neondatabase/serverless'

function getSQL() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL nicht gesetzt')
  return neon(url)
}

export async function ensureTable() {
  const sql = getSQL()

  // Users
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'setter',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // Lists — jeder CSV-Import bekommt eine eigene Liste
  await sql`
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      imported_by TEXT DEFAULT '',
      total_leads INTEGER DEFAULT 0,
      duplicates_skipped INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // Leads
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT DEFAULT '',
      website TEXT DEFAULT '',
      owner TEXT DEFAULT '',
      status TEXT DEFAULT '',
      call_note TEXT DEFAULT '',
      wiedervorlage TEXT DEFAULT '',
      called_at TIMESTAMPTZ DEFAULT NULL,
      created_at TEXT DEFAULT '',
      assigned_to TEXT DEFAULT '',
      list_id TEXT DEFAULT '',
      call_count INTEGER DEFAULT 0,
      extra JSONB DEFAULT '{}'
    )
  `

  // Migrationen für bestehende DBs
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS list_id TEXT DEFAULT ''`
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_count INTEGER DEFAULT 0`
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS extra JSONB DEFAULT '{}'`
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT ''`

  // called_at zu TIMESTAMPTZ migrieren — erst leere Strings auf NULL setzen, dann casten
  try {
    await sql`UPDATE leads SET called_at = NULL WHERE called_at = ''`
    await sql`ALTER TABLE leads ALTER COLUMN called_at TYPE TIMESTAMPTZ USING NULLIF(called_at, '')::TIMESTAMPTZ`
  } catch {}

  // Call History — jeder einzelne Call wird geloggt
  await sql`
    CREATE TABLE IF NOT EXISTS call_history (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      lead_name TEXT DEFAULT '',
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      status TEXT DEFAULT '',
      call_note TEXT DEFAULT '',
      called_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // Settings
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '[]'
    )
  `

  // Reps — per User Streak
  await sql`
    CREATE TABLE IF NOT EXISTS reps (
      rep_id TEXT PRIMARY KEY,
      flow_streak INTEGER NOT NULL DEFAULT 0,
      last_call_at BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // Activity Log
  await sql`
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      lead_id TEXT DEFAULT '',
      lead_name TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
}

// ── Users ──────────────────────────────────────────────────────────────────────

export async function getAllUsers() {
  const sql = getSQL()
  await ensureTable()
  return await sql`SELECT id, username, role, created_at FROM users ORDER BY created_at ASC`
}

export async function getUserByUsername(username: string) {
  const sql = getSQL()
  await ensureTable()
  const rows = await sql`SELECT * FROM users WHERE username = ${username}`
  return rows[0] || null
}

export async function getUserById(id: string) {
  const sql = getSQL()
  await ensureTable()
  const rows = await sql`SELECT * FROM users WHERE id = ${id}`
  return rows[0] || null
}

export async function createUser(id: string, username: string, passwordHash: string, role: string) {
  const sql = getSQL()
  await ensureTable()
  await sql`INSERT INTO users (id, username, password_hash, role) VALUES (${id}, ${username}, ${passwordHash}, ${role})`
}

export async function deleteUser(id: string) {
  const sql = getSQL()
  await sql`DELETE FROM users WHERE id = ${id}`
}

export async function updateUserPassword(id: string, passwordHash: string) {
  const sql = getSQL()
  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`
}

// ── Lists ──────────────────────────────────────────────────────────────────────

export async function createList(id: string, name: string, importedBy: string, totalLeads: number, duplicatesSkipped: number) {
  const sql = getSQL()
  await ensureTable()
  await sql`
    INSERT INTO lists (id, name, imported_by, total_leads, duplicates_skipped)
    VALUES (${id}, ${name}, ${importedBy}, ${totalLeads}, ${duplicatesSkipped})
  `
}

export async function getAllLists() {
  const sql = getSQL()
  await ensureTable()
  return await sql`SELECT * FROM lists ORDER BY created_at DESC`
}

export async function deleteList(id: string) {
  const sql = getSQL()
  await sql`DELETE FROM leads WHERE list_id = ${id}`
  await sql`DELETE FROM lists WHERE id = ${id}`
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export async function getAllLeads(assignedTo?: string, listId?: string) {
  const sql = getSQL()
  await ensureTable()
  if (assignedTo && listId) {
    return (await sql`SELECT * FROM leads WHERE assigned_to = ${assignedTo} AND list_id = ${listId} ORDER BY created_at ASC, id ASC`).map(rowToLead)
  }
  if (assignedTo) {
    return (await sql`SELECT * FROM leads WHERE assigned_to = ${assignedTo} ORDER BY created_at ASC, id ASC`).map(rowToLead)
  }
  if (listId) {
    return (await sql`SELECT * FROM leads WHERE list_id = ${listId} ORDER BY created_at ASC, id ASC`).map(rowToLead)
  }
  return (await sql`SELECT * FROM leads ORDER BY created_at ASC, id ASC`).map(rowToLead)
}

// Importiert Leads — behält alte, checkt Duplikate auf Telefonnummer
export async function importLeads(leads: any[], listId: string): Promise<{ inserted: number; skipped: number }> {
  const sql = getSQL()
  await ensureTable()

  // Alle existierenden Telefonnummern laden für Duplikat-Check
  const existing = await sql`SELECT phone FROM leads WHERE phone IS NOT NULL AND phone != ''`
  const existingPhones = new Set(existing.map((r: any) => normalizePhone(r.phone)))

  let inserted = 0
  let skipped = 0

  for (const l of leads) {
    const phone = normalizePhone(l.phone || '')

    // Duplikat-Check auf Telefonnummer
    if (phone && existingPhones.has(phone)) {
      skipped++
      continue
    }

    const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    await sql`
      INSERT INTO leads (id, name, phone, website, owner, status, call_note, wiedervorlage, called_at, created_at, assigned_to, list_id, call_count, extra)
      VALUES (
        ${id}, ${l.name ?? ''}, ${l.phone ?? ''}, ${l.website ?? ''},
        ${l.owner ?? ''}, ${l.status ?? ''}, ${l.callNote ?? ''},
        ${l.wiedervorlage ?? ''}, NULL, ${l.createdAt ?? new Date().toISOString().slice(0,10)},
        ${l.assignedTo || ''}, ${listId}, 0,
        ${JSON.stringify(l.extra ?? {})}
      )
      ON CONFLICT (id) DO NOTHING
    `

    if (phone) existingPhones.add(phone)
    inserted++
  }

  return { inserted, skipped }
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\/]/g, '').toLowerCase()
}

export async function addLead(lead: any) {
  const sql = getSQL()
  await ensureTable()
  await sql`
    INSERT INTO leads (id, name, phone, website, owner, status, call_note, wiedervorlage, called_at, created_at, assigned_to, list_id, call_count, extra)
    VALUES (
      ${lead.id}, ${lead.name ?? ''}, ${lead.phone ?? ''}, ${lead.website ?? ''},
      ${lead.owner ?? ''}, ${lead.status ?? ''}, ${lead.callNote ?? ''},
      ${lead.wiedervorlage ?? ''}, NULL, ${lead.createdAt ?? ''},
      ${lead.assignedTo || ''}, ${lead.listId || ''}, 0,
      ${JSON.stringify(lead.extra ?? {})}
    )
  `
}

export async function updateLead(id: string, data: any) {
  const sql = getSQL()

  const name          = data.name          !== undefined ? data.name          : null
  const phone         = data.phone         !== undefined ? data.phone         : null
  const website       = data.website       !== undefined ? data.website       : null
  const owner         = data.owner         !== undefined ? data.owner         : null
  const status        = data.status        !== undefined ? data.status        : null
  const callNote      = data.callNote      !== undefined ? data.callNote      : null
  const wiedervorlage = data.wiedervorlage !== undefined ? data.wiedervorlage : null
  const assignedTo    = data.assignedTo    !== undefined ? data.assignedTo    : null
  const extra         = data.extra         !== undefined ? JSON.stringify(data.extra) : null

  if (data.calledAt !== undefined) {
    // calledAt als Timestamp speichern
    const calledAt = data.calledAt ? new Date(data.calledAt).toISOString() : null
    await sql`
      UPDATE leads SET
        name          = COALESCE(${name}, name),
        phone         = COALESCE(${phone}, phone),
        website       = COALESCE(${website}, website),
        owner         = COALESCE(${owner}, owner),
        status        = COALESCE(${status}, status),
        call_note     = COALESCE(${callNote}, call_note),
        wiedervorlage = COALESCE(${wiedervorlage}, wiedervorlage),
        called_at     = ${calledAt}::TIMESTAMPTZ,
        call_count    = call_count + 1,
        assigned_to   = COALESCE(${assignedTo}, assigned_to),
        extra         = COALESCE(${extra}::jsonb, extra)
      WHERE id = ${id}
    `
  } else {
    await sql`
      UPDATE leads SET
        name          = COALESCE(${name}, name),
        phone         = COALESCE(${phone}, phone),
        website       = COALESCE(${website}, website),
        owner         = COALESCE(${owner}, owner),
        status        = COALESCE(${status}, status),
        call_note     = COALESCE(${callNote}, call_note),
        wiedervorlage = COALESCE(${wiedervorlage}, wiedervorlage),
        assigned_to   = COALESCE(${assignedTo}, assigned_to),
        extra         = COALESCE(${extra}::jsonb, extra)
      WHERE id = ${id}
    `
  }
}

export async function deleteLead(id: string) {
  const sql = getSQL()
  await sql`DELETE FROM leads WHERE id = ${id}`
}

// ── Call History ───────────────────────────────────────────────────────────────

export async function logCallHistory(entry: {
  leadId: string; leadName: string; userId: string; username: string;
  status: string; callNote: string;
}) {
  const sql = getSQL()
  await ensureTable()
  const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  await sql`
    INSERT INTO call_history (id, lead_id, lead_name, user_id, username, status, call_note, called_at)
    VALUES (${id}, ${entry.leadId}, ${entry.leadName}, ${entry.userId}, ${entry.username}, ${entry.status}, ${entry.callNote}, NOW())
  `
}

export async function getCallHistory(userId?: string, limit = 500) {
  const sql = getSQL()
  await ensureTable()
  if (userId) {
    return await sql`SELECT * FROM call_history WHERE user_id = ${userId} ORDER BY called_at DESC LIMIT ${limit}`
  }
  return await sql`SELECT * FROM call_history ORDER BY called_at DESC LIMIT ${limit}`
}

// Performance-Stats pro User
export async function getPerformanceStats(since?: string) {
  const sql = getSQL()
  await ensureTable()
  const fromDate = since || new Date(Date.now() - 30 * 86400000).toISOString()

  // Calls pro User pro Tag + Uhrzeiten
  const callsPerUser = await sql`
    SELECT
      user_id,
      username,
      DATE(called_at AT TIME ZONE 'Europe/Berlin') as call_date,
      COUNT(*) as call_count,
      MIN(called_at AT TIME ZONE 'Europe/Berlin') as first_call,
      MAX(called_at AT TIME ZONE 'Europe/Berlin') as last_call,
      EXTRACT(HOUR FROM MIN(called_at AT TIME ZONE 'Europe/Berlin')) as first_call_hour
    FROM call_history
    WHERE called_at >= ${fromDate}
    GROUP BY user_id, username, DATE(called_at AT TIME ZONE 'Europe/Berlin')
    ORDER BY call_date DESC, username ASC
  `

  // Calls pro Stunde (Heatmap)
  const callsPerHour = await sql`
    SELECT
      user_id,
      username,
      EXTRACT(HOUR FROM called_at AT TIME ZONE 'Europe/Berlin') as hour,
      COUNT(*) as call_count
    FROM call_history
    WHERE called_at >= ${fromDate}
    GROUP BY user_id, username, EXTRACT(HOUR FROM called_at AT TIME ZONE 'Europe/Berlin')
    ORDER BY hour ASC
  `

  // Conversion pro User
  const conversionPerUser = await sql`
    SELECT
      user_id,
      username,
      status,
      COUNT(*) as count
    FROM call_history
    WHERE called_at >= ${fromDate} AND status != ''
    GROUP BY user_id, username, status
    ORDER BY username, count DESC
  `

  // Pause zwischen Calls pro User heute
  const pauseStats = await sql`
    SELECT
      user_id,
      username,
      called_at,
      LAG(called_at) OVER (PARTITION BY user_id ORDER BY called_at) as prev_call_at
    FROM call_history
    WHERE DATE(called_at AT TIME ZONE 'Europe/Berlin') = CURRENT_DATE AT TIME ZONE 'Europe/Berlin'
    ORDER BY user_id, called_at
  `

  return { callsPerUser, callsPerHour, conversionPerUser, pauseStats }
}

// ── Activity Log ───────────────────────────────────────────────────────────────

export async function logActivity(entry: {
  id: string; userId: string; username: string;
  action: string; leadId?: string; leadName?: string; detail?: string
}) {
  const sql = getSQL()
  await ensureTable()
  await sql`
    INSERT INTO activity_log (id, user_id, username, action, lead_id, lead_name, detail)
    VALUES (
      ${entry.id}, ${entry.userId}, ${entry.username},
      ${entry.action}, ${entry.leadId || ''}, ${entry.leadName || ''}, ${entry.detail || ''}
    )
  `
}

export async function getActivityLog(limit = 200, userId?: string) {
  const sql = getSQL()
  await ensureTable()
  if (userId) {
    return await sql`SELECT * FROM activity_log WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}`
  }
  return await sql`SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ${limit}`
}

export async function getActivityStats() {
  const sql = getSQL()
  await ensureTable()
  return await sql`
    SELECT username, user_id, COUNT(*) as call_count
    FROM activity_log
    WHERE action = 'call' AND created_at::date = CURRENT_DATE
    GROUP BY username, user_id
    ORDER BY call_count DESC
  `
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<any[]> {
  const sql = getSQL()
  await ensureTable()
  const rows = await sql`SELECT value FROM settings WHERE key = ${key}`
  if (!rows.length) return []
  return rows[0].value ?? []
}

export async function setSetting(key: string, value: any[]): Promise<void> {
  const sql = getSQL()
  await ensureTable()
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}::jsonb
  `
}

// ── Reps (Streak per User) ────────────────────────────────────────────────────

export async function getRep(repId: string): Promise<{ flowStreak: number; lastCallAt: number }> {
  const sql = getSQL()
  await ensureTable()
  const rows = await sql`SELECT flow_streak, last_call_at FROM reps WHERE rep_id = ${repId}`
  if (!rows.length) return { flowStreak: 0, lastCallAt: 0 }
  return { flowStreak: rows[0].flow_streak, lastCallAt: Number(rows[0].last_call_at) }
}

export async function updateRep(repId: string, flowStreak: number, lastCallAt: number): Promise<void> {
  const sql = getSQL()
  await ensureTable()
  await sql`
    INSERT INTO reps (rep_id, flow_streak, last_call_at, updated_at)
    VALUES (${repId}, ${flowStreak}, ${lastCallAt}, NOW())
    ON CONFLICT (rep_id) DO UPDATE SET
      flow_streak  = ${flowStreak},
      last_call_at = ${lastCallAt},
      updated_at   = NOW()
  `
}

export async function getAllReps() {
  const sql = getSQL()
  await ensureTable()
  const rows = await sql`SELECT rep_id, flow_streak, last_call_at, updated_at FROM reps ORDER BY updated_at DESC`
  return rows.map(r => ({
    repId: r.rep_id,
    flowStreak: r.flow_streak,
    lastCallAt: Number(r.last_call_at),
    updatedAt: r.updated_at,
  }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToLead(row: any) {
  // calledAt als YYYY-MM-DD im lokalen Format für dailyCountsFromLeads
  let calledAt = ''
  if (row.called_at) {
    const d = new Date(row.called_at)
    calledAt = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    website: row.website,
    owner: row.owner,
    status: row.status,
    callNote: row.call_note,
    wiedervorlage: row.wiedervorlage,
    calledAt,
    calledAtFull: row.called_at ? new Date(row.called_at).toISOString() : '',
    createdAt: row.created_at,
    assignedTo: row.assigned_to || '',
    listId: row.list_id || '',
    callCount: row.call_count || 0,
    extra: row.extra ?? {},
  }
}
