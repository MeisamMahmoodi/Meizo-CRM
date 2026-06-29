import { NextResponse } from 'next/server'
import { getAllReps, getRep, updateRep } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const repId = searchParams.get('repId')
    if (repId) {
      const rep = await getRep(repId)
      return NextResponse.json(rep)
    }
    const reps = await getAllReps()
    return NextResponse.json(reps)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { repId, flowStreak, lastCallAt } = await req.json()
    if (!repId) return NextResponse.json({ error: 'repId fehlt' }, { status: 400 })
    await updateRep(repId, flowStreak ?? 0, lastCallAt ?? 0)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
