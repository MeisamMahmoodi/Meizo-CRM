export type LeadStatus = string

export interface StatusMeta {
  label: string
  color: string
  bg: string
  autoAdvance: boolean
}

export interface CustomStatus {
  value: string
  label: string
  color: string
  bg: string
  autoAdvance: boolean
}

export interface CallEvent {
  id: string
  leadId: string
  status: LeadStatus
  at: string
}

export interface CustomColumn {
  key: string
  label: string
  type: 'text' | 'email' | 'url' | 'number'
}

export interface Lead {
  id: string
  name: string
  phone: string
  website: string
  owner: string
  status: LeadStatus
  callNote: string
  wiedervorlage: string
  calledAt: string        // YYYY-MM-DD lokales Datum
  calledAtFull?: string   // ISO Timestamp für Zeitanzeige
  createdAt: string
  assignedTo: string
  listId: string
  callCount: number
  extra?: Record<string, string>
}

// Custom Columns — DB-backed via settings API (kein localStorage mehr)
export async function loadCustomColumns(): Promise<CustomColumn[]> {
  return loadSettingFromDB('custom_columns')
}

export async function saveCustomColumns(cols: CustomColumn[]): Promise<void> {
  return saveSettingToDB('custom_columns', cols)
}

export const DAILY_GOAL = 30

export const STATUS_COLORS = [
  { color: '#1e40af', bg: '#dbeafe' },
  { color: '#065f46', bg: '#d1fae5' },
  { color: '#92400e', bg: '#fef3c7' },
  { color: '#5b21b6', bg: '#ede9fe' },
  { color: '#991b1b', bg: '#fee2e2' },
  { color: '#0f766e', bg: '#ccfbf1' },
  { color: '#9f1239', bg: '#ffe4e6' },
]

export const BUILT_IN_STATUS_VALUES = ['KI', 'NDG', 'AP NE', 'Nur Email', 'Info per Email', 'Closing Termin'] as const

export const STATUS_META: Record<string, StatusMeta> = {
  'KI':             { label: 'Kein Interesse',    color: '#991b1b', bg: '#fee2e2', autoAdvance: true  },
  'NDG':            { label: 'Nicht Durchgekommen', color: '#374151', bg: '#f3f4f6', autoAdvance: true  },
  'AP NE':          { label: 'AP Nicht Erreicht', color: '#92400e', bg: '#fef3c7', autoAdvance: false },
  'Nur Email':      { label: 'Nur E-Mail',         color: '#1e40af', bg: '#dbeafe', autoAdvance: true  },
  'Info per Email': { label: 'Info per E-Mail',    color: '#5b21b6', bg: '#ede9fe', autoAdvance: false },
  'Closing Termin': { label: 'Closing Termin',     color: '#065f46', bg: '#d1fae5', autoAdvance: false },
}

// Statuses die NICHT mehr angerufen werden sollen
export const DEAD_STATUSES = ['KI', 'Closing Termin']


// ── Date Helpers ──────────────────────────────────────────────────────────────

export function dateKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

export function previousBusinessDate(date: Date): Date {
  let cursor = addDays(date, -1)
  while (isWeekend(cursor)) cursor = addDays(cursor, -1)
  return cursor
}

// ── Status Helpers ────────────────────────────────────────────────────────────

export function getStatusMeta(status: LeadStatus, customStatuses: CustomStatus[] = []): StatusMeta | null {
  if (!status) return null
  return customStatuses.find(s => s.value === status) || STATUS_META[status] || {
    label: status,
    color: '#374151',
    bg: '#f3f4f6',
    autoAdvance: false,
  }
}

export function getStatusOptions(customStatuses: CustomStatus[] = []): CustomStatus[] {
  return [
    ...BUILT_IN_STATUS_VALUES.map(value => ({ value, ...STATUS_META[value] })),
    ...customStatuses,
  ]
}

// ── Custom Status localStorage helpers (Fallback) ─────────────────────────────

export function loadCustomStatuses(): CustomStatus[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('meizo_custom_statuses')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((s: any) => s?.value && s?.label) : []
  } catch { return [] }
}

// saveCustomStatuses — nur noch DB, kein localStorage
export async function saveCustomStatuses(statuses: CustomStatus[]): Promise<void> {
  return saveSettingToDB('custom_statuses', statuses)
}

// ── Daily Counts ──────────────────────────────────────────────────────────────

export function dailyCountsFromLeads(leads: Lead[]): Record<string, number> {
  return leads.reduce<Record<string, number>>((acc, lead) => {
    const key = (lead.calledAt || '').slice(0, 10)
    if (!key) return acc
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

// Soll dieser Lead im Dialer erscheinen?
// Logik: Lead ist dialable wenn:
//   a) WDV fällig (unabhängig vom Status) — Warm Call
//   b) Kein "toter" Status
//   c) Kein Status und noch nie angerufen — Cold Call
//   d) Hat Status aber kein toter Status und keine WDV — nochmal versuchen
export function isDialable(lead: Lead, today = dateKey()): boolean {
  // Toter Status → nie mehr anrufen
  if (DEAD_STATUSES.includes(lead.status)) return false
  // Custom toter Status (autoAdvance auf final gesetzt)? — nicht möglich ohne extra flag, also alle custom zeigen
  // WDV fällig → immer anrufen
  if (lead.wiedervorlage && lead.wiedervorlage <= today) return true
  // Kein Status → anrufen
  if (!lead.status) return true
  // Hat Status (NDG, AP NE, Voicemail etc.) aber keine WDV → nochmal versuchen
  return true
}

// Settings aus DB laden (cross-browser synchron)
export async function loadSettingFromDB(key: string): Promise<any[]> {
  try {
    const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`)
    if (!res.ok) return []
    const data = await res.json()
    return data.value ?? []
  } catch { return [] }
}

export async function saveSettingToDB(key: string, value: any[]): Promise<void> {
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
  } catch {}
}

const KEY = 'meizo_crm_leads'
const AUTH_KEY = 'meizo_crm_auth'
const CUSTOM_STATUS_KEY = 'meizo_custom_statuses'
// recordCallEvent — deprecated, call_history wird jetzt in DB gespeichert (via /api/activity)
// Stub bleibt für Rückwärtskompatibilität
export function recordCallEvent(_leadId: string, _status: LeadStatus, _at = new Date()): void {
  // noop — Call-History wird serverseitig in call_history Tabelle gespeichert
}


export function computeBusinessStreak(counts: Record<string, number>, target = DAILY_GOAL, now = new Date()): number {
  let cursor = parseDateKey(dateKey(now))

  if (isWeekend(cursor)) {
    cursor = previousBusinessDate(cursor)
  } else if ((counts[dateKey(cursor)] || 0) < target) {
    cursor = previousBusinessDate(cursor)
  }

  let streak = 0
  while (true) {
    if (isWeekend(cursor)) {
      cursor = addDays(cursor, -1)
      continue
    }

    if ((counts[dateKey(cursor)] || 0) < target) break
    streak += 1
    cursor = addDays(cursor, -1)
  }

  return streak
}

export function loadLeads(): Lead[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveLeads(leads: Lead[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(leads))
}

export function clearLeads(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(KEY)
}

export function isAuthed(): boolean {
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(AUTH_KEY) === '1'
}

export function setAuthed(): void {
  sessionStorage.setItem(AUTH_KEY, '1')
}

export function setRepId(id: string): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem('meizo_rep_id', id)
}

export function getRepId(): string {
  if (typeof window === 'undefined') return 'unknown'
  return sessionStorage.getItem('meizo_rep_id') || 'unknown'
}

// Zerlegt eine CSV-Zeile korrekt, auch wenn Felder in Anführungszeichen Kommas enthalten
// (z.B. eine Adresse wie "Baumbachstr. 4, München") - ein einfacher .split(',') würde das falsch aufteilen.
function splitCSVLine(line: string, sep: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      } else cur += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === sep) { result.push(cur.trim()); cur = '' }
      else cur += ch
    }
  }
  result.push(cur.trim())
  return result
}

export function parseCSV(text: string): Lead[] {
  const clean = text.replace(/^\uFEFF/, '') // BOM entfernen
  const lines = clean.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const sep = lines[0].includes(';') ? ';' : ','
  const header = splitCSVLine(lines[0], sep).map(h => h.toLowerCase().replace(/['"]/g, ''))

  const col = (keys: string[]) => header.findIndex(h => keys.some(k => h.includes(k)))
  const iName  = col(['name', 'firma', 'company', 'unternehmen'])
  const iPhone = col(['tel', 'phone', 'nummer', 'mobil', 'fon'])
  const iWeb   = col(['web', 'site', 'url', 'homepage'])
  const iOwner = col(['inhaber', 'owner', 'geschäftsführer', 'geschaeftsfuehrer', 'ansprechpartner'])
  const iNote  = col(['notiz', 'note', 'anmerk', 'komment'])
  const iStatus = col(['status'])

  const now = dateKey()
  return lines.slice(1).map((line, i) => {
    const cols = splitCSVLine(line, sep).map(c => c.replace(/^["']|["']$/g, ''))
    const get = (idx: number) => (idx >= 0 ? cols[idx] || '' : '')
    const rawStatus = get(iStatus)

    return {
      id: `lead_${i}_${Date.now()}`,
      name: iName >= 0 ? get(iName) : cols[0] || '',
      phone: iPhone >= 0 ? get(iPhone) : cols[1] || '',
      website: iWeb >= 0 ? get(iWeb) : '',
      owner: get(iOwner),
      status: rawStatus,
      callNote: get(iNote),
      wiedervorlage: '',
      calledAt: '',
      calledAtFull: '',
      createdAt: now,
      assignedTo: '',
      listId: '',
      callCount: 0,
    }
  }).filter(l => l.name.trim())
}

export function exportCSV(leads: Lead[]): void {
  const headers = ['Name', 'Telefon', 'Website', 'Inhaber', 'Status', 'Wiedervorlage', 'Notiz', 'Angerufen am']
  const rows = leads.map(l =>
    [l.name, l.phone, l.website, l.owner, l.status, l.wiedervorlage, l.callNote, l.calledAt]
      .map(v => `"${(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  )
  const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `meizo-crm-export-${new Date().toISOString().slice(0,10)}.csv`
  a.click()
}

export function formatDate(d: string): string {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}.${m}.${y}`
}

// ── New session helpers ────────────────────────────────────────────────────────
export function getSession(): { userId: string; username: string; role: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const s = sessionStorage.getItem('meizo_session')
    return s ? JSON.parse(s) : null
  } catch { return null }
}

export function isAuthedNew(): boolean {
  return getSession() !== null
}
