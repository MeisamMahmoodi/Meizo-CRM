import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // /api/auth ist öffentlich — kein Cookie nötig zum Einloggen
  if (pathname === '/api/auth') return NextResponse.next()

  // Alle anderen API-Routen brauchen eine gültige Session
  const session = req.cookies.get('meizo_session')?.value
  if (!session) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 })
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(session))
    if (!parsed?.userId || !parsed?.role) {
      return NextResponse.json({ error: 'Ungültige Session' }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: 'Ungültige Session' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  // Nur API-Routen außer /api/auth absichern
  matcher: ['/api/((?!auth).*)'],
}
