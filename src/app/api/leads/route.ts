import { NextResponse } from 'next/server'
import { getAllLeads, importLeads, addLead, createList } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const assignedTo = searchParams.get('assignedTo') || undefined
    const listId = searchParams.get('listId') || undefined
    const leads = await getAllLeads(assignedTo, listId)
    return NextResponse.json(leads)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const body = await req.json()

    // Bulk-Import mit Listen-Konzept
    if (Array.isArray(body)) {
      const listName = searchParams.get('listName') || `Import ${new Date().toLocaleDateString('de-DE')}`
      const importedBy = searchParams.get('importedBy') || ''
      const listId = `list_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`

      const { inserted, skipped } = await importLeads(body, listId)

      await createList(listId, listName, importedBy, inserted, skipped)

      return NextResponse.json({ ok: true, listId, inserted, skipped })
    }

    // Einzelner Lead
    await addLead(body)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
