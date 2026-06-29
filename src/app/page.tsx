'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const session = sessionStorage.getItem('meizo_session')
    if (session) {
      const s = JSON.parse(session)
      if (s.role === 'admin') router.replace('/admin')
      else router.replace('/dashboard')
    }
  }, [router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Fehler'); setLoading(false); return }
      const sessionStr = JSON.stringify(data)
      sessionStorage.setItem('meizo_session', sessionStr)
      // Cookie für API-Middleware Auth
      document.cookie = `meizo_session=${encodeURIComponent(sessionStr)}; path=/; SameSite=Strict`
      if (data.role === 'admin') router.replace('/admin')
      else router.replace('/dashboard')
    } catch { setError('Verbindungsfehler'); setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a' }}>
      <div style={{ width: 340 }}>
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <img src="/logo.png" alt="Meizo" style={{ width: 72, height: 72, borderRadius: 18, marginBottom: 18, display: 'block', margin: '0 auto 18px' }} />
          <div style={{ fontSize: 22, fontWeight: 600, color: '#fff', letterSpacing: '-0.02em' }}>meizoCRM</div>
          <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>Sales Pipeline</div>
        </div>
        <form onSubmit={submit} style={{ background: '#141414', borderRadius: 16, border: '1px solid #222', padding: '28px 24px' }}>
          <div style={{ marginBottom: 16 }}>
            <label style={lbl}>Benutzername</label>
            <input type="text" value={username} onChange={e => { setUsername(e.target.value); setError('') }} autoFocus autoComplete="username" placeholder="benutzername" style={{ ...inp, borderColor: error ? '#ef4444' : '#333' }} />
          </div>
          <div style={{ marginBottom: error ? 8 : 20 }}>
            <label style={lbl}>Passwort</label>
            <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError('') }} autoComplete="current-password" placeholder="••••••••" style={{ ...inp, borderColor: error ? '#ef4444' : '#333' }} />
          </div>
          {error && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 14 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: '11px 16px', background: loading ? '#333' : '#fff', color: loading ? '#666' : '#0a0a0a', borderRadius: 10, fontSize: 14, fontWeight: 600, border: 'none', cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'Einloggen…' : 'Einloggen'}
          </button>
        </form>
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }
const inp: React.CSSProperties = { width: '100%', padding: '11px 14px', border: '1px solid #333', borderRadius: 10, outline: 'none', background: '#0a0a0a', color: '#fff', fontSize: 15 }
