import { NextResponse } from 'next/server'
import { getActivityLog, getActivityStats, logActivity, logCallHistory, getCallHistory, getPerformanceStats } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId') || undefined
    const stats = searchParams.get('stats')
    const performance = searchParams.get('performance')
    const history = searchParams.get('history')
    const since = searchParams.get('since') || undefined

    if (performance) {
      const data = await getPerformanceStats(since)
      return NextResponse.json(data)
    }
    if (stats) {
      const data = await getActivityStats()
      return NextResponse.json(data)
    }
    if (history) {
      const data = await getCallHistory(userId, 1000)
      return NextResponse.json(data)
    }
    const logs = await getActivityLog(200, userId)
    return NextResponse.json(logs)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    // Call-History loggen
    if (body.action === 'call' && body.leadId) {
      await logCallHistory({
        leadId: body.leadId,
        leadName: body.leadName || '',
        userId: body.userId || '',
        username: body.username || '',
        status: body.detail || '',
        callNote: body.callNote || '',
      })
    }

    await logActivity({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...body
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
