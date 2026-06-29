import { NextResponse } from 'next/server'
import { getSetting, setSetting } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const key = searchParams.get('key')
    if (!key) return NextResponse.json({ error: 'key fehlt' }, { status: 400 })
    const value = await getSetting(key)
    return NextResponse.json({ key, value })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { key, value } = await req.json()
    if (!key) return NextResponse.json({ error: 'key fehlt' }, { status: 400 })
    await setSetting(key, value)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
