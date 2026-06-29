import { NextResponse } from 'next/server'
import { getUserByUsername, logActivity } from '@/lib/db'
import { createHash } from 'crypto'

function hash(pw: string) {
  return createHash('sha256').update(pw + 'meizo_salt_2024').digest('hex')
}

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json()
    if (!username || !password) return NextResponse.json({ error: 'Fehlende Felder' }, { status: 400 })

    // Admin-Login via env var — WARNUNG: Standard-Passwort setzen via ADMIN_PASSWORD env var!
    const adminUser = process.env.ADMIN_USERNAME || 'admin'
    const adminPass = process.env.ADMIN_PASSWORD
    if (!adminPass) {
      console.warn('[SECURITY] ADMIN_PASSWORD env var nicht gesetzt! Bitte sofort setzen.')
    }

    if (username === adminUser && password === (adminPass || 'meizo2024')) {
      await logActivity({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        userId: 'admin',
        username: adminUser,
        action: 'login',
        detail: 'Admin Login',
      })
      return NextResponse.json({ ok: true, userId: 'admin', username: adminUser, role: 'admin' })
    }

    const user = await getUserByUsername(username)
    if (!user) return NextResponse.json({ error: 'Ungültige Anmeldedaten' }, { status: 401 })
    if (user.password_hash !== hash(password)) return NextResponse.json({ error: 'Ungültige Anmeldedaten' }, { status: 401 })

    await logActivity({
      id: `log_${Date.now()}`,
      userId: user.id,
      username: user.username,
      action: 'login',
      detail: `${user.role} Login`,
    })

    return NextResponse.json({ ok: true, userId: user.id, username: user.username, role: user.role })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
