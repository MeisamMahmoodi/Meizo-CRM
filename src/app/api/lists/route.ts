import { NextResponse } from 'next/server'
import { getAllLists, deleteList } from '@/lib/db'

export async function GET() {
  try {
    const lists = await getAllLists()
    return NextResponse.json(lists)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id fehlt' }, { status: 400 })
    await deleteList(id)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
