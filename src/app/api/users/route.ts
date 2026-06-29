import { NextResponse } from 'next/server'
import { getAllUsers, createUser, deleteUser, updateUserPassword } from '@/lib/db'
import { createHash } from 'crypto'

function hash(pw: string) {
  return createHash('sha256').update(pw + 'meizo_salt_2024').digest('hex')
}

export async function GET() {
  try {
    const users = await getAllUsers()
    return NextResponse.json(users)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { username, password, role } = await req.json()
    if (!username || !password || !role) return NextResponse.json({ error: 'Fehlende Felder' }, { status: 400 })
    const id = `user_${Date.now()}`
    await createUser(id, username, hash(password), role)
    return NextResponse.json({ ok: true, id })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json()
    await deleteUser(id)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const { id, password } = await req.json()
    await updateUserPassword(id, hash(password))
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
