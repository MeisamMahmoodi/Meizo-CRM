import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

function getSQL() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL nicht gesetzt')
  return neon(url)
}

export async function GET() {
  try {
    const sql = getSQL()

    // Beste Stunden basierend auf positiven Status (Info per Email, Closing Termin)
    const bestHours = await sql`
      SELECT
        EXTRACT(HOUR FROM called_at AT TIME ZONE 'Europe/Berlin') as hour,
        COUNT(*) as total_calls,
        SUM(CASE WHEN status IN ('Info per Email', 'Closing Termin') THEN 1 ELSE 0 END) as positive_calls,
        ROUND(
          100.0 * SUM(CASE WHEN status IN ('Info per Email', 'Closing Termin') THEN 1 ELSE 0 END)
          / NULLIF(COUNT(*), 0), 1
        ) as positive_rate
      FROM call_history
      WHERE called_at >= NOW() - INTERVAL '30 days'
        AND status != ''
      GROUP BY EXTRACT(HOUR FROM called_at AT TIME ZONE 'Europe/Berlin')
      HAVING COUNT(*) >= 3
      ORDER BY positive_rate DESC, total_calls DESC
      LIMIT 3
    `

    return NextResponse.json({ bestHours })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
