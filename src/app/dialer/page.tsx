'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession,
  CustomStatus, Lead, LeadStatus, DAILY_GOAL,
  dateKey, formatDate, getStatusMeta, getStatusOptions,
  loadSettingFromDB,
  dailyCountsFromLeads, DEAD_STATUSES,
} from '@/lib/crm'

const SIP_DOMAIN = process.env.NEXT_PUBLIC_SIP_DOMAIN || 'pbx.easybell.de'
function sipLink(p: string) { return `sip:${p.replace(/\s/g, '')}@${SIP_DOMAIN}` }
function isValidWebsite(w: string) {
  const v = w.trim(); if (!v || /\s/.test(v)) return false
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\.[a-z]{2,}$/i.test(v.replace(/^https?:\/\//i, '').split('/')[0])
}
function websiteHref(w: string) { return w.startsWith('http') ? w : `https://${w}` }
function daysSince(d: string) {
  if (!d) return ''
  const diff = Math.round((Date.now() - new Date(d + 'T12:00:00').getTime()) / 86400000)
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Gestern'
  return `vor ${diff} Tagen`
}

type QueueMode = 'all' | 'cold' | 'wdv' | 'ndg' | 'retry'
const QUEUE_MODES: { id: QueueMode; label: string; desc: string }[] = [
  { id: 'all',   label: 'Alles',          desc: 'WDV → Kalt → Retry' },
  { id: 'wdv',   label: 'WDV fällig',     desc: 'Nur überfällige Wiedervorlagen' },
  { id: 'cold',  label: 'Nie angerufen',  desc: 'Nur Cold Calls' },
  { id: 'ndg',   label: 'NDG / AP NE',    desc: 'Nicht durchgekommen' },
  { id: 'retry', label: 'Retry',          desc: 'Alle bereits kontaktierten' },
]

function buildQueue(leads: Lead[], mode: QueueMode, today: string): Lead[] {
  const alive = leads.filter(l => !DEAD_STATUSES.includes(l.status))
  switch (mode) {
    case 'wdv':   return alive.filter(l => l.wiedervorlage && l.wiedervorlage <= today).sort((a, b) => a.wiedervorlage.localeCompare(b.wiedervorlage))
    case 'cold':  return alive.filter(l => !l.calledAt && !l.status)
    case 'ndg':   return alive.filter(l => l.status === 'NDG' || l.status === 'AP NE')
    case 'retry': return alive.filter(l => l.calledAt || l.status)
    default: {
      const wdv   = alive.filter(l => l.wiedervorlage && l.wiedervorlage <= today).sort((a, b) => a.wiedervorlage.localeCompare(b.wiedervorlage))
      const cold  = alive.filter(l => !l.calledAt && !l.status)
      const retry = alive.filter(l => !(l.wiedervorlage && l.wiedervorlage <= today) && (l.calledAt || l.status))
      return [...wdv, ...cold, ...retry]
    }
  }
}

// SVG Icons
const PhoneIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.64 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
const ExternalIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
const ChevronRight = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
const ChevronDown = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
const BackIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
const CheckIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>

export default function DialerPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [customStatuses, setCustomStatuses] = useState<CustomStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [queueMode, setQueueMode] = useState<QueueMode>('all')
  const [callIdx, setCallIdx] = useState(0)
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus | null>(null)
  const [editData, setEditData] = useState<Partial<Lead>>({})
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'default'|'success'|'gold'>('default')
  const [streak, setStreak] = useState(0)
  const [isSkipping, setIsSkipping] = useState(false)
  const [showModeSelector, setShowModeSelector] = useState(false)
  const [bestHours, setBestHours] = useState<{ hour: number; positive_rate: number }[]>([])
  const [isFlying, setIsFlying] = useState(false)
  const confettiRef = useRef<HTMLCanvasElement>(null)
  const goalFiredRef = useRef(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const fetchLeads = useCallback(async () => {
    try {
      const s = getSession()
      const param = s && s.role !== 'admin' ? 'assignedTo=' + s.userId : ''
      const res = await fetch('/api/leads?' + param)
      if (res.ok) setLeads(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    const s = getSession(); if (!s) { router.replace('/'); return }
    loadSettingFromDB('custom_statuses').then(cs => { if (cs.length) setCustomStatuses(cs) })
    fetch('/api/reps?repId=' + (getSession()?.userId || 'shared')).then(r => r.json()).then(d => {
      if (d.lastCallAt && Date.now() - d.lastCallAt < 10 * 60 * 1000) setStreak(d.flowStreak || 0)
    }).catch(() => {})
    fetchLeads()
    fetch('/api/calltime').then(r => r.json()).then(d => { if (d.bestHours?.length) setBestHours(d.bestHours) }).catch(() => {})
    const iv = setInterval(fetchLeads, 8000)
    return () => clearInterval(iv)
  }, [router, fetchLeads])

  useEffect(() => { setSelectedStatus(null); setEditData({}) }, [callIdx])

  // Focus note on N key
  useEffect(() => {
    const statusOptions = getStatusOptions(customStatuses)
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (e.key === 'n' || e.key === 'N') { noteRef.current?.focus(); return }
      const n = parseInt(e.key)
      if (n >= 1 && n <= statusOptions.length) { setSelectedStatus(statusOptions[n - 1].value); return }
      if (e.key === 'Enter' && selectedStatus) { applyCallStatus(selectedStatus); return }
      if (e.key === ' ') { e.preventDefault(); skipLead() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [customStatuses, selectedStatus])

  function fireConfetti(canvas: HTMLCanvasElement, gold = false) {
    const ctx = canvas.getContext('2d'); if (!ctx) return
    canvas.width = window.innerWidth; canvas.height = window.innerHeight
    const colors = gold ? ['#fbbf24','#f59e0b','#fcd34d','#fff'] : ['#16a34a','#22c55e','#38bdf8','#f97316','#fbbf24']
    const ps = Array.from({ length: 140 }, () => ({
      x: canvas.width/2, y: canvas.height*.28,
      vx: (Math.random()-.5)*16, vy: (Math.random()-.88)*14,
      g: .22+Math.random()*.12, r: Math.random()*360,
      spin: (Math.random()-.5)*18, size: 5+Math.random()*8,
      life: 1, color: colors[Math.floor(Math.random()*colors.length)]
    }))
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); let alive = false
      ps.forEach(p => {
        p.x+=p.vx; p.y+=p.vy; p.vy+=p.g; p.r+=p.spin; p.life-=.013
        if (p.life<=0) return; alive=true
        ctx.save(); ctx.globalAlpha=Math.max(p.life,0)
        ctx.translate(p.x,p.y); ctx.rotate(p.r*Math.PI/180)
        ctx.fillStyle=p.color; ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*.65)
        ctx.restore()
      })
      if (alive) requestAnimationFrame(draw)
    }
    draw()
  }

  const today = dateKey()
  const callLeads = buildQueue(leads, queueMode, today)
  const currentLead = callLeads[callIdx]
  const statusOptions = getStatusOptions(customStatuses)
  const todayCount = dailyCountsFromLeads(leads)[today] || 0
  const progress = callLeads.length > 0 ? Math.min((callIdx / callLeads.length) * 100, 100) : 0
  const wvOverdue  = leads.filter(l => l.wiedervorlage && l.wiedervorlage < today && !DEAD_STATUSES.includes(l.status)).length
  const wvToday    = leads.filter(l => l.wiedervorlage === today && !DEAD_STATUSES.includes(l.status)).length
  const coldCount  = leads.filter(l => !l.calledAt && !l.status).length
  const ndgCount   = leads.filter(l => (l.status === 'NDG' || l.status === 'AP NE')).length

  function autoWdv(status: LeadStatus): string {
    const d = new Date()
    const add = (days: number) => { d.setDate(d.getDate() + days); return dateKey(d) }
    if (status === 'NDG') return add(2)
    if (status === 'AP NE') return add(1)
    if (status === 'Info per Email') return add(3)
    if (status === 'KI') return add(30)
    return ''
  }

  async function applyCallStatus(status: LeadStatus) {
    if (!currentLead || isFlying) return
    let wdv = editData.wiedervorlage !== undefined ? editData.wiedervorlage : currentLead.wiedervorlage
    if (!editData.wiedervorlage && !DEAD_STATUSES.includes(status)) {
      const auto = autoWdv(status); if (auto) wdv = auto
    }
    if (DEAD_STATUSES.includes(status)) wdv = ''
    const callNote = editData.callNote !== undefined ? editData.callNote : currentLead.callNote
    const now = new Date()
    const payload = { status, calledAt: now.toISOString(), wiedervorlage: wdv, callNote }

    setIsFlying(true)
    setTimeout(() => {
      setCallIdx(i => i + 1)
      setIsFlying(false)
      setEditData({}); setSelectedStatus(null)
    }, 340)

    const res = await fetch(`/api/leads/${currentLead.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    })
    if (!res.ok) { showToast('Fehler beim Speichern', 'default'); return }

    const s = getSession()
    fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: s?.userId, username: s?.username, action: 'call', leadId: currentLead.id, leadName: currentLead.name, detail: status, callNote }) }).catch(() => {})

    const ns = streak + 1; setStreak(ns)
    fetch('/api/reps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repId: s?.userId || 'shared', flowStreak: ns, lastCallAt: Date.now() }) }).catch(() => {})

    const label = getStatusMeta(status, customStatuses)?.label || status
    const isClosing = status === 'Closing Termin'
    showToast(isClosing ? `Closing Termin gesetzt` : label, isClosing ? 'gold' : 'success')

    await fetchLeads()
    const newCount = todayCount + 1
    if (newCount >= DAILY_GOAL && !goalFiredRef.current && confettiRef.current) {
      goalFiredRef.current = true; fireConfetti(confettiRef.current)
    }
    if (isClosing && confettiRef.current) fireConfetti(confettiRef.current, true)
  }

  function skipLead() {
    if (isSkipping || isFlying) return
    setIsSkipping(true)
    setTimeout(() => { setCallIdx(i => i + 1); setIsSkipping(false) }, 160)
  }

  function showToast(msg: string, type: 'default'|'success'|'gold' = 'default') {
    setToast(msg); setToastType(type); setTimeout(() => setToast(''), 2200)
  }

  function switchMode(mode: QueueMode) {
    setQueueMode(mode); setCallIdx(0); setSelectedStatus(null); setEditData({})
    setShowModeSelector(false)
    showToast(QUEUE_MODES.find(m => m.id === mode)?.label || '', 'default')
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
      Laden…
    </div>
  )

  const currentMode = QUEUE_MODES.find(m => m.id === queueMode)!

  // Queue leer
  if (!currentLead) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <canvas ref={confettiRef} style={{ position: 'fixed', inset: 0, zIndex: 100, pointerEvents: 'none' }} />
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ width: 56, height: 56, background: '#dcfce7', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 24 }}>✓</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.3px' }}>Queue leer</div>
          <div style={{ color: '#999', fontSize: 14, marginBottom: 28 }}>
            {todayCount} Calls heute · Flow {streak}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {coldCount > 0 && queueMode !== 'cold' && (
              <button onClick={() => switchMode('cold')} style={{ padding: '12px 16px', background: '#eff6ff', color: '#1e40af', borderRadius: 10, border: '1px solid #bfdbfe', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {coldCount} Cold Calls verfügbar →
              </button>
            )}
            {(wvOverdue + wvToday) > 0 && queueMode !== 'wdv' && (
              <button onClick={() => switchMode('wdv')} style={{ padding: '12px 16px', background: '#fef3c7', color: '#92400e', borderRadius: 10, border: '1px solid #fcd34d', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {wvOverdue + wvToday} Wiedervorlagen fällig →
              </button>
            )}
            {ndgCount > 0 && queueMode !== 'ndg' && (
              <button onClick={() => switchMode('ndg')} style={{ padding: '12px 16px', background: '#f5f5f5', color: '#333', borderRadius: 10, border: '1px solid #e5e5e5', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {ndgCount} NDG / AP NE →
              </button>
            )}
          </div>
          <button onClick={() => router.push('/dashboard')} style={{ padding: '11px 24px', background: '#111', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            ← Dashboard
          </button>
        </div>
      </div>
    )
  }

  const isWdv = !!(currentLead.wiedervorlage && currentLead.wiedervorlage <= today)
  const isCold = !currentLead.calledAt && !currentLead.status
  const isClosingSelected = selectedStatus === 'Closing Termin'

  // Best call time
  const nowHour = new Date().getHours()
  const bestNow = bestHours.find(h => h.hour === nowHour)
  const nextBest = bestHours.find(h => h.hour > nowHour)
  const showBestTime = bestNow || nextBest

  return (
    <div style={{ minHeight: '100vh', background: '#f7f7f6', paddingBottom: 48 }}>
      <canvas ref={confettiRef} style={{ position: 'fixed', inset: 0, zIndex: 100, pointerEvents: 'none' }} />

      <div style={{ maxWidth: 500, margin: '0 auto', padding: '20px 16px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <button onClick={() => router.push('/dashboard')} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#999', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <BackIcon /> Dashboard
          </button>
          <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={S.statLabel}>Heute</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: todayCount >= DAILY_GOAL ? '#16a34a' : '#111', lineHeight: 1 }}>{todayCount}</div>
            </div>
            {streak > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={S.statLabel}>Flow</div>
                <div style={{ fontSize: 19, fontWeight: 700, color: '#d97706', lineHeight: 1 }}>{streak}</div>
              </div>
            )}
            <div style={{ textAlign: 'right' }}>
              <div style={S.statLabel}>Queue</div>
              <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1 }}>
                {callIdx + 1}<span style={{ fontSize: 13, fontWeight: 400, color: '#bbb' }}> / {callLeads.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fortschritt heute</span>
            <span style={{ fontSize: 11, color: '#bbb' }}>{todayCount} / {DAILY_GOAL} Calls</span>
          </div>
          <div style={{ height: 3, background: '#e8e8e5', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: todayCount >= DAILY_GOAL ? '#16a34a' : '#111', borderRadius: 99, width: `${Math.min((todayCount/DAILY_GOAL)*100,100)}%`, transition: 'width .4s' }} />
          </div>
        </div>

        {/* Queue Mode Bar */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <button
            onClick={() => setShowModeSelector(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: '#fff', border: '1px solid #e8e8e5', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
          >
            <span style={{ flex: 1, textAlign: 'left', color: '#111' }}>{currentMode.label}</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {wvOverdue+wvToday > 0 && <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>{wvOverdue+wvToday} WDV</span>}
              {coldCount > 0 && <span style={{ fontSize: 11, color: '#6b7280' }}>{coldCount} kalt</span>}
              <span style={{ color: '#bbb' }}><ChevronDown /></span>
            </div>
          </button>

          {showModeSelector && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #e8e8e5', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', marginTop: 4, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px 8px', display: 'flex', gap: 12, borderBottom: '1px solid #f0f0ee', flexWrap: 'wrap' }}>
                {[
                  { label: `${wvOverdue} überfällig`, color: wvOverdue > 0 ? '#dc2626' : '#bbb' },
                  { label: `${wvToday} heute`, color: wvToday > 0 ? '#d97706' : '#bbb' },
                  { label: `${coldCount} kalt`, color: coldCount > 0 ? '#2563eb' : '#bbb' },
                  { label: `${ndgCount} NDG`, color: '#bbb' },
                ].map(s => <span key={s.label} style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.label}</span>)}
              </div>
              {QUEUE_MODES.map(m => (
                <button key={m.id} onClick={() => switchMode(m.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', width: '100%', background: queueMode === m.id ? '#f7f7f6' : 'transparent', border: 'none', borderBottom: '1px solid #f0f0ee', fontSize: 13, cursor: 'pointer', textAlign: 'left', color: '#111' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: queueMode === m.id ? 700 : 500 }}>{m.label}</div>
                    <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{m.desc}</div>
                  </div>
                  {queueMode === m.id && <span style={{ color: '#16a34a' }}><CheckIcon /></span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Best call time */}
        {showBestTime && (
          <div style={{ background: bestNow ? '#f0fdf4' : '#f8faff', border: `1px solid ${bestNow ? '#bbf7d0' : '#dbeafe'}`, borderRadius: 8, padding: '7px 13px', marginBottom: 10, fontSize: 12, color: bestNow ? '#15803d' : '#1d4ed8', fontWeight: 500 }}>
            {bestNow ? `Jetzt beste Anrufzeit — ${bestNow.positive_rate}% Conversion` : `Beste Anrufzeit: ${nextBest!.hour}:00 Uhr — ${nextBest!.positive_rate}% Conversion`}
          </div>
        )}

        {/* Priority Badges */}
        {isWdv && (
          <div style={{ background: '#fef9ec', border: '1px solid #fcd34d', borderRadius: 8, padding: '7px 13px', marginBottom: 10, fontSize: 12, color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#d97706' }} />
            Wiedervorlage {currentLead.wiedervorlage < today ? `überfällig seit ${formatDate(currentLead.wiedervorlage)}` : 'fällig heute'}
          </div>
        )}
        {isCold && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '7px 13px', marginBottom: 10, fontSize: 12, color: '#1e40af', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563eb' }} />
            Cold Call — noch nie angerufen
          </div>
        )}

        {/* Lead Card */}
        <div className={isFlying ? 'lead-fly-away' : ''} style={S.card}>

          {/* Lead Info + History */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {isValidWebsite(currentLead.website) ? (
                <a href={websiteHref(currentLead.website)} target="_blank" rel="noopener noreferrer">
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#111', lineHeight: 1.2, letterSpacing: '-0.3px' }}>{currentLead.name}</div>
                </a>
              ) : (
                <div style={{ fontSize: 20, fontWeight: 700, color: '#111', lineHeight: 1.2, letterSpacing: '-0.3px' }}>{currentLead.name}</div>
              )}
              {currentLead.owner && <div style={{ fontSize: 13, color: '#777', marginTop: 5 }}>{currentLead.owner}</div>}
              {isValidWebsite(currentLead.website) && (
                <a href={websiteHref(currentLead.website)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#2563eb', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  {currentLead.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                  <ExternalIcon />
                </a>
              )}
            </div>
            {currentLead.calledAt && (
              <div style={{ background: '#f7f7f6', border: '1px solid #e8e8e5', borderRadius: 8, padding: '8px 12px', textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Letzter Kontakt</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#333', marginTop: 2 }}>{daysSince(currentLead.calledAt)}</div>
                {currentLead.status && <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{currentLead.status}</div>}
                {currentLead.callCount > 0 && <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{currentLead.callCount}× angerufen</div>}
              </div>
            )}
          </div>

          {/* Call Button */}
          {currentLead.phone ? (
            <a
              href={sipLink(currentLead.phone)}
              style={{ ...S.callBtn, ...(isCold ? { animation: 'subtlePulse 2s ease-in-out infinite' } : {}) }}
              onClick={() => {
                const s = getSession()
                if (!s) return
                fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: s.userId, username: s.username, action: 'call', leadId: currentLead.id, leadName: currentLead.name, detail: 'Anruf gestartet', callNote: '' }) }).catch(() => {})
                fetch(`/api/leads/${currentLead.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calledAt: new Date().toISOString() }) }).catch(() => {})
              }}
            >
              <div style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.15)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <PhoneIcon />
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: '#fff', flex: 1, letterSpacing: '0.2px' }}>{currentLead.phone}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
                Anrufen <ChevronRight />
              </div>
            </a>
          ) : (
            <div style={{ ...S.callBtn, background: '#f5f5f5', border: '1px solid #e8e8e5', cursor: 'default' }}>
              <span style={{ color: '#bbb', fontSize: 13 }}>Keine Telefonnummer</span>
            </div>
          )}

          {/* Last Note */}
          {currentLead.callNote && (
            <div style={{ marginTop: 12, background: '#f7f7f6', borderRadius: 8, padding: '10px 13px', border: '1px solid #f0f0ee' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Letzte Notiz</div>
              <div style={{ fontSize: 13, color: '#555', lineHeight: 1.55 }}>{currentLead.callNote}</div>
            </div>
          )}
        </div>

        {/* Note Input — always visible, no label */}
        <div style={{ background: '#fff', border: '1px solid #e8e8e5', borderRadius: 10, marginBottom: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <textarea
            ref={noteRef}
            value={editData.callNote !== undefined ? editData.callNote : (currentLead.callNote ?? '')}
            onChange={e => setEditData(d => ({ ...d, callNote: e.target.value }))}
            placeholder="Notiz tippen… (N)"
            rows={2}
            style={{ width: '100%', padding: '13px 15px', border: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 13, color: '#111', resize: 'none', outline: 'none', lineHeight: 1.5 }}
          />
        </div>

        {/* Status Grid */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ergebnis wählen</span>
          <span style={{ fontSize: 10, color: '#d0d0cc' }}>1–{statusOptions.length} · Enter · Space = skip · N = Notiz</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
          {statusOptions.map((status, i) => {
            const isSel = selectedStatus === status.value
            const isDead = DEAD_STATUSES.includes(status.value)
            const isGold = status.value === 'Closing Termin'
            return (
              <button key={status.value}
                onClick={() => setSelectedStatus(prev => prev === status.value ? null : status.value)}
                style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: isSel ? (isGold ? '#fef9ec' : '#f0fdf4') : '#fff',
                  color: isSel ? (isGold ? '#78350f' : '#14532d') : isDead ? '#aaa' : '#444',
                  border: isSel ? `1.5px solid ${isGold ? '#fcd34d' : '#86efac'}` : '1px solid #e8e8e5',
                  fontSize: 13, fontWeight: isSel ? 600 : 500, textAlign: 'left',
                  transition: 'all 100ms', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  opacity: isDead && !isSel ? 0.55 : 1,
                  boxShadow: isSel ? (isGold ? '0 0 0 3px rgba(252,211,77,0.15)' : '0 0 0 3px rgba(134,239,172,0.2)') : '0 1px 2px rgba(0,0,0,0.04)',
                }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: isSel ? (isGold ? '#d97706' : '#16a34a') : '#ccc', minWidth: 14, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: isSel ? (isGold ? '#d97706' : '#16a34a') : '#ddd' }} />
                <span style={{ flex: 1 }}>{status.label}</span>
                {isDead && !isSel && <span style={{ fontSize: 9, color: '#ccc', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>final</span>}
                {isGold && !isSel && <span style={{ fontSize: 11, color: '#d97706' }}>✦</span>}
                {isSel && <CheckIcon />}
              </button>
            )
          })}
        </div>

        {/* WDV Quickpicks */}
        {selectedStatus && !DEAD_STATUSES.includes(selectedStatus) && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#bbb', marginRight: 2 }}>WDV:</span>
              {[{ label: 'Morgen', days: 1 }, { label: '3 Tage', days: 3 }, { label: '1 Woche', days: 7 }, { label: '2 Wochen', days: 14 }].map(({ label, days }) => {
                const d = new Date(); d.setDate(d.getDate() + days); const val = dateKey(d)
                const isActive = editData.wiedervorlage === val
                return (
                  <button key={days} onClick={() => setEditData(p => ({ ...p, wiedervorlage: isActive ? '' : val }))}
                    style={{ padding: '5px 11px', fontSize: 11, borderRadius: 99, border: isActive ? '1.5px solid #111' : '1px solid #e8e8e5', background: isActive ? '#111' : '#fff', color: isActive ? '#fff' : '#555', cursor: 'pointer', fontWeight: 600, transition: 'all 100ms' }}>
                    {label}
                  </button>
                )
              })}
              <input type="date" value={editData.wiedervorlage ?? currentLead.wiedervorlage ?? ''} onChange={e => setEditData(d => ({ ...d, wiedervorlage: e.target.value }))}
                style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #e8e8e5', borderRadius: 8, background: '#fff', color: '#555', outline: 'none', cursor: 'pointer' }} />
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          <button onClick={skipLead} disabled={isSkipping || isFlying} style={{ padding: '14px', borderRadius: 10, background: '#fff', color: '#777', border: '1px solid #e8e8e5', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            Überspringen
            <span style={{ fontSize: 9, color: '#ccc', background: '#f5f5f5', border: '1px solid #e8e8e5', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>Space</span>
          </button>
          <button
            onClick={() => selectedStatus && applyCallStatus(selectedStatus)}
            disabled={!selectedStatus || isSkipping || isFlying}
            style={{
              padding: '14px', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none',
              background: selectedStatus ? (isClosingSelected ? '#d97706' : '#111') : '#f0f0ee',
              color: selectedStatus ? '#fff' : '#bbb',
              cursor: selectedStatus ? 'pointer' : 'not-allowed',
              transition: 'all .15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: selectedStatus ? (isClosingSelected ? '0 4px 16px rgba(217,119,6,0.25)' : '0 4px 16px rgba(0,0,0,0.15)') : 'none',
            }}>
            {isClosingSelected ? '✦ Closing Termin' : 'Bestätigen & weiter'}
            <span style={{ fontSize: 10, opacity: 0.5, background: 'rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>Enter</span>
          </button>
        </div>

      </div>

      {/* Toast */}
      {toast && (
        <div className="fade-in" style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: toastType === 'gold' ? '#d97706' : toastType === 'success' ? '#111' : '#333',
          color: '#fff', padding: '9px 22px', borderRadius: 100,
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 200,
          whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}

      <style>{`
        @keyframes subtlePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); }
          50% { box-shadow: 0 0 0 4px rgba(22,163,74,0.12); }
        }
      `}</style>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  statLabel: { fontSize: 10, fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 },
  card: { background: '#fff', border: '1px solid #e8e8e5', borderRadius: 14, padding: 20, marginBottom: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
  callBtn: { display: 'flex', alignItems: 'center', gap: 14, background: '#16a34a', borderRadius: 10, padding: '15px 17px', textDecoration: 'none', cursor: 'pointer', width: '100%', border: 'none', position: 'relative' as const, overflow: 'hidden' as const },
}
