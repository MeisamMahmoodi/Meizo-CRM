'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getSession,
  DAILY_GOAL, Lead, CustomStatus,
  dateKey, addDays, isWeekend, previousBusinessDate,
  computeBusinessStreak, dailyCountsFromLeads,
  getStatusOptions, loadSettingFromDB,
} from '@/lib/crm'

function getLast7WorkDays(): string[] {
  const days: string[] = []
  let cursor = new Date()
  while (days.length < 7) {
    if (!isWeekend(cursor)) days.unshift(dateKey(cursor))
    cursor = addDays(cursor, -1)
  }
  return days
}

function ghostCount(counts: Record<string, number>): number | null {
  const yesterday = dateKey(previousBusinessDate(new Date()))
  const total = counts[yesterday]
  if (!total) return null
  const now = new Date()
  const fraction = (now.getHours() * 60 + now.getMinutes()) / (9 * 60)
  return Math.round(total * Math.min(fraction, 1))
}

function fireConfetti(canvas: HTMLCanvasElement, gold = false) {
  const ctx = canvas.getContext('2d'); if (!ctx) return
  canvas.width = window.innerWidth; canvas.height = window.innerHeight
  const colors = gold ? ['#fbbf24', '#f59e0b', '#fcd34d', '#fff'] : ['#16a34a', '#22c55e', '#38bdf8', '#f97316', '#fbbf24']
  const ps = Array.from({ length: 120 }, () => ({
    x: canvas.width / 2, y: canvas.height * .3,
    vx: (Math.random() - .5) * 14, vy: (Math.random() - .85) * 13,
    g: .22 + Math.random() * .12, r: Math.random() * 360,
    spin: (Math.random() - .5) * 18, size: 5 + Math.random() * 8,
    life: 1, color: colors[Math.floor(Math.random() * colors.length)]
  }))
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let alive = false
    ps.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.r += p.spin; p.life -= .013
      if (p.life <= 0) return; alive = true
      ctx.save(); ctx.globalAlpha = Math.max(p.life, 0)
      ctx.translate(p.x, p.y); ctx.rotate(p.r * Math.PI / 180)
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .65)
      ctx.restore()
    })
    if (alive) requestAnimationFrame(draw)
  }
  draw()
}

export default function DashboardPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [customStatuses, setCustomStatuses] = useState<CustomStatus[]>([])
  const [flowStreak, setFlowStreak] = useState(0)
  const [lastCallAt, setLastCallAt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())
  const [myPerf, setMyPerf] = useState<any>(null)
  const confettiRef = useRef<HTMLCanvasElement>(null)
  const confettiFiredRef = useRef<Set<string>>(new Set())
  const fetchAll = useCallback(async () => {
    const session = getSession()
    try {
      const assignedParam = session && session.role !== 'admin' ? 'assignedTo=' + session.userId : ''
      const [leadsRes, repRes] = await Promise.all([
        fetch('/api/leads?' + assignedParam),
        fetch('/api/reps?repId=' + (session?.userId || 'shared')),
      ])
      if (leadsRes.ok) setLeads(await leadsRes.json())
      if (repRes.ok) {
        const rep = await repRes.json()
        setFlowStreak(rep.flowStreak ?? 0)
        setLastCallAt(rep.lastCallAt ?? 0)
      }
    } catch {}
    setLoading(false)
  }, [])

  const fetchMyPerf = useCallback(async () => {
    const session = getSession()
    if (!session || session.role === 'admin') return
    try {
      const res = await fetch(`/api/activity?performance=1`)
      if (res.ok) {
        const data = await res.json()
        // Filter nur eigene Daten
        setMyPerf({
          callsPerUser: data.callsPerUser?.filter((r: any) => r.user_id === session?.userId) || [],
          conversionPerUser: data.conversionPerUser?.filter((r: any) => r.user_id === session?.userId) || [],
          pauseStats: data.pauseStats?.filter((r: any) => r.user_id === session?.userId) || [],
        })
      }
    } catch {}
  }, [])

  useEffect(() => {
    const _session = getSession(); if (!_session) { router.replace('/'); return }
    loadSettingFromDB('custom_statuses').then(s => { if (s.length) setCustomStatuses(s) })
    fetchAll()
    fetchMyPerf()
    const poll = setInterval(fetchAll, 5000)
    const tick = setInterval(() => setNow(new Date()), 60_000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [router, fetchAll, fetchMyPerf])

  const today = dateKey(now)
  const counts = dailyCountsFromLeads(leads)
  const todayCount = counts[today] || 0
  const streak = computeBusinessStreak(counts, DAILY_GOAL, now)
  const last7 = getLast7WorkDays()
  const weekTotal = last7.reduce((s, d) => s + (counts[d] || 0), 0)
  const weekGoal = 5 * DAILY_GOAL
  const allTimeRecord = Math.max(0, ...Object.values(counts))
  const ghost = ghostCount(counts)
  const statusOptions = getStatusOptions(customStatuses)
  const todayLeads = leads.filter(l => l.calledAt?.slice(0, 10) === today)
  const statusBreakdown = statusOptions
    .map(s => ({ ...s, count: todayLeads.filter(l => l.status === s.value).length }))
    .filter(s => s.count > 0)
  const openCount = leads.filter(l => !l.status).length
  const wvDueCount = leads.filter(l => l.wiedervorlage && l.wiedervorlage <= today).length
  const momentum = last7.slice(-5).map(d => (counts[d] || 0) > 0)
  const pct = Math.min((todayCount / DAILY_GOAL) * 100, 100)
  const goalReached = todayCount >= DAILY_GOAL
  const hyperdrive = todayCount > allTimeRecord && allTimeRecord > 0
  const isFlowActive = Date.now() - lastCallAt < 10 * 60 * 1000
  const totalCalled = leads.filter(l => l.calledAt).length
  const closingTotal = leads.filter(l => l.status === 'Closing Termin').length
  const closingToday = todayLeads.filter(l => l.status === 'Closing Termin').length
  const conversion = totalCalled > 0 ? ((closingTotal / totalCalled) * 100).toFixed(1) : '0'

  // Meine heutige Performance
  const todayPerf = myPerf?.callsPerUser?.find((r: any) => r.call_date?.slice(0, 10) === today)
  const myPauses: number[] = []
  myPerf?.pauseStats?.forEach((r: any) => {
    if (!r.prev_call_at) return
    const diff = (new Date(r.called_at).getTime() - new Date(r.prev_call_at).getTime()) / 1000 / 60
    if (diff > 0 && diff < 120) myPauses.push(diff)
  })
  const avgPause = myPauses.length ? Math.round(myPauses.reduce((a, b) => a + b, 0) / myPauses.length) : null
  const myConv = myPerf?.conversionPerUser || []
  const myTotal = myConv.reduce((s: number, r: any) => s + Number(r.count), 0)
  const myClosings = myConv.find((r: any) => r.status === 'Closing Termin')?.count || 0

  useEffect(() => {
    if (!confettiRef.current || loading) return
    const key_goal = `goal_${today}`
    const key_record = `record_${today}`
    if (todayCount >= DAILY_GOAL && !confettiFiredRef.current.has(key_goal)) {
      if (hyperdrive && !confettiFiredRef.current.has(key_record)) {
        confettiFiredRef.current.add(key_record)
        fireConfetti(confettiRef.current, true)
      } else {
        confettiFiredRef.current.add(key_goal)
        fireConfetti(confettiRef.current, false)
      }
    }
  }, [todayCount, hyperdrive, today, loading])

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Laden…</div>

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 100 }}>
      <canvas ref={confettiRef} style={{ position: 'fixed', top: 0, left: 0, zIndex: 100, pointerEvents: 'none' }} />
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px' }}>

        {/* Hauptmetriken */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
          <div style={{ ...card, borderLeft: `3px solid ${goalReached ? '#22c55e' : '#378ADD'}`, borderRadius: '0 var(--radius-lg) var(--radius-lg) 0' }}>
            <div style={lbl}>Heute</div>
            <div style={{ fontSize: 32, fontWeight: 500, lineHeight: 1, color: goalReached ? '#16a34a' : 'var(--text)' }}>
              {todayCount} <span style={{ fontSize: 18, color: 'var(--text-muted)', fontWeight: 400 }}>/ {DAILY_GOAL}</span>
            </div>
            <div style={{ marginTop: 10, background: 'var(--bg)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 99, background: goalReached ? '#16a34a' : '#378ADD', width: `${pct}%`, transition: 'width .4s' }} />
            </div>
            <div style={{ ...sub, marginTop: 5 }}>{goalReached ? '✓ Ziel erreicht!' : `noch ${DAILY_GOAL - todayCount} Calls`}</div>
          </div>

          <div style={{ ...card, ...(hyperdrive ? { border: '1px solid #f59e0b', boxShadow: '0 0 0 3px rgba(245,158,11,.15)' } : {}) }}>
            <div style={lbl}>Rekord</div>
            <div style={{ fontSize: 32, fontWeight: 500, color: '#d97706' }}>{allTimeRecord}</div>
            {hyperdrive
              ? <div style={{ ...sub, color: '#d97706', marginTop: 6 }}>🏆 Neuer Rekord!</div>
              : <div style={{ ...sub, marginTop: 6 }}>noch {Math.max(0, allTimeRecord - todayCount + 1)} bis Rekord</div>}
          </div>

          <div style={card}>
            <div style={lbl}>Conversion</div>
            <div style={{ fontSize: 32, fontWeight: 500, color: Number(conversion) > 5 ? '#16a34a' : 'var(--text)' }}>{conversion}%</div>
            <div style={{ ...sub, marginTop: 6 }}>{closingTotal} Closings · {totalCalled} Calls gesamt</div>
          </div>

          <div style={card}>
            <div style={lbl}>Flow 🔥</div>
            <div style={{ fontSize: 32, fontWeight: 500, color: isFlowActive ? '#d97706' : 'var(--text-muted)' }}>
              {isFlowActive ? flowStreak : '–'}
            </div>
            <div style={{ ...sub, marginTop: 6 }}>{isFlowActive ? 'Calls am Laufen' : 'Kein aktiver Flow'}</div>
          </div>
        </div>

        {/* Meine Performance heute (nur für Setter) */}
        {getSession()?.role !== 'admin' && myPerf && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
            <div style={card}>
              <div style={lbl}>Erster Call heute</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                {todayPerf?.first_call ? new Date(todayPerf.first_call).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </div>
            <div style={card}>
              <div style={lbl}>Letzter Call heute</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                {todayPerf?.last_call ? new Date(todayPerf.last_call).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </div>
            <div style={card}>
              <div style={lbl}>Ø Pause zwischen Calls</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: avgPause && avgPause > 10 ? '#dc2626' : '#16a34a' }}>
                {avgPause ? `${avgPause} Min` : '—'}
              </div>
            </div>
            <div style={card}>
              <div style={lbl}>Meine Closings (gesamt)</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: '#16a34a' }}>
                {myClosings} <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}>/ {myTotal} Calls</span>
              </div>
            </div>
          </div>
        )}

        {/* Chart + Status */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={lbl}>Wochenverlauf</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Calls pro Tag — Ziel {DAILY_GOAL}</div>
              </div>
              {weekTotal > 0 && <span style={{ ...bdg, background: '#d1fae5', color: '#065f46' }}>{weekTotal} diese Woche</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80 }}>
              {last7.map(d => {
                const c = counts[d] || 0
                const isToday = d === today
                const hit = c >= DAILY_GOAL
                const barH = Math.max(4, (Math.min(c / DAILY_GOAL, 1)) * 72)
                const dayName = new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' })
                return (
                  <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: hit ? '#16a34a' : isToday ? '#378ADD' : 'var(--text-muted)' }}>{c || ''}</div>
                    <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', height: 72 }}>
                      <div style={{ width: '100%', height: barH, background: hit ? '#16a34a' : isToday ? '#378ADD' : 'var(--border)', borderRadius: '4px 4px 0 0', transition: 'height .3s' }} />
                    </div>
                    <div style={{ fontSize: 11, color: isToday ? 'var(--text)' : 'var(--text-muted)', fontWeight: isToday ? 600 : 400 }}>{dayName}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={card}>
            <div style={{ ...lbl, marginBottom: 12 }}>Heute nach Status</div>
            {statusBreakdown.length === 0
              ? <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>Noch keine Calls heute.</div>
              : statusBreakdown.map(s => (
                <div key={s.value} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{s.count}</span>
                  </div>
                  <div style={{ background: 'var(--bg)', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, background: s.color, width: `${Math.round((s.count / Math.max(todayCount, 1)) * 100)}%` }} />
                  </div>
                </div>
              ))
            }
            <div style={{ borderTop: '1px solid var(--border-light)', marginTop: 12, paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Closing heute</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#16a34a' }}>{closingToday}</span>
              </div>
              {wvDueCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: '#d97706' }}>Wdv. fällig</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#d97706' }}>{wvDueCount}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Streak + Momentum + Ghost */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
          <div style={card}>
            <div style={lbl}>Tages-Streak</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', border: `3px solid ${streak > 0 ? '#f59e0b' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', flexShrink: 0 }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>🔥</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: streak > 0 ? '#d97706' : 'var(--text-muted)', lineHeight: 1.2 }}>{streak}</span>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{streak === 0 ? 'Noch kein Streak' : `${streak} Tag${streak > 1 ? 'e' : ''} in Folge`}</div>
                <div style={{ ...sub, marginTop: 3 }}>Sa + So zählen nicht</div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={lbl}>Momentum (letzte 5 Tage)</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {momentum.map((active, i) => (
                <div key={i} style={{ flex: 1, height: 20, borderRadius: 4, background: active ? '#16a34a' : 'var(--bg)', border: `1px solid ${active ? '#16a34a' : 'var(--border)'}`, transition: 'background .3s' }} />
              ))}
            </div>
            <div style={{ ...sub, marginTop: 8 }}>{momentum.filter(Boolean).length}/5 Tage aktiv</div>
          </div>

          <div style={card}>
            <div style={lbl}>Ghost-Mode</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 500 }}>{todayCount}</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>jetzt</span>
              {ghost !== null && (
                <><span style={{ fontSize: 13, color: 'var(--text-faint)' }}>vs.</span>
                  <span style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-secondary)' }}>{ghost}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>gestern</span></>
              )}
            </div>
            {ghost !== null && (
              <span style={{ ...bdg, marginTop: 6, display: 'inline-block', background: todayCount >= ghost ? '#d1fae5' : '#fee2e2', color: todayCount >= ghost ? '#065f46' : '#991b1b' }}>
                {todayCount >= ghost ? `+${todayCount - ghost} vor Gestern` : `${ghost - todayCount} hinter Gestern`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Banner */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 20px', background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Bereit für die nächsten Calls?</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {openCount > 0 ? `${openCount} offene Leads warten` : 'Alle Leads abgearbeitet 🎉'}
              {wvDueCount > 0 && ` · ${wvDueCount} Wdv. fällig`}
            </div>
          </div>
          <button
            onClick={() => router.push('/dialer')}
            style={{ padding: '12px 32px', background: '#16a34a', color: '#fff', borderRadius: 'var(--radius-lg)', fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer' }}
          >
            Anrufen starten →
          </button>
        </div>
      </div>
    </div>
  )
}

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 18, boxShadow: 'var(--shadow-sm)' }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }
const sub: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' }
const bdg: React.CSSProperties = { display: 'inline-block', padding: '2px 9px', borderRadius: 99, fontSize: 11, fontWeight: 500 }
