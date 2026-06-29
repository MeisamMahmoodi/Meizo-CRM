'use client'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getSession } from '@/lib/crm'

export function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [session, setSession] = useState<{ username: string; role: string } | null>(null)

  useEffect(() => {
    setSession(getSession())
  }, [pathname])

  // Nicht anzeigen auf Login-Seite oder Admin-Seite
  if (!session || pathname === '/' || pathname === '/admin') return null

  const isActive = (href: string) => pathname === href

  function logout() {
    sessionStorage.removeItem('meizo_session')
    document.cookie = 'meizo_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    router.replace('/')
  }

  return (
    <nav style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div style={{
        maxWidth: 1320,
        margin: '0 auto',
        padding: '0 20px',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <img src="/logo.png" alt="" style={{ width: 28, height: 28, borderRadius: 7 }} />
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            meizoCRM
          </span>
        </Link>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {[
            { href: '/dashboard', label: 'Dashboard' },
            { href: '/leads', label: 'Leads' },
            { href: '/kanban', label: 'Kanban' },
            { href: '/dialer', label: 'Anrufen' },
            { href: '/email', label: 'E-Mails' },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius)',
                fontSize: 13,
                fontWeight: 500,
                textDecoration: 'none',
                color: isActive(href) ? '#fff' : 'var(--text-secondary)',
                background: isActive(href) ? 'var(--accent)' : 'transparent',
                transition: 'all 150ms',
              }}
            >
              {label}
            </Link>
          ))}

          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 8px' }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{session.username}</span>
          <button
            onClick={logout}
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', marginLeft: 4 }}
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  )
}
