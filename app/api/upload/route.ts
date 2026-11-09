import { NextRequest, NextResponse } from 'next/server'
import { uploadBufferToR2 } from '@/lib/r2-upload'
import { isAdminSecret } from '@/lib/auth/admin-secret'

export async function POST(req: NextRequest) {
  try {
    if (!isAdminSecret(req.nextUrl.searchParams.get('secret'))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Determine file type
    // We can trust the mime type from the file object or inspect buffer
    // For simplicity, rely on file.type but fall back to extension from name
    const ext = file.name.split('.').pop()
    const filename = `avatars/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`

    const url = await uploadBufferToR2(buffer, filename, file.type || 'application/octet-stream')

    if (!url) {
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    return NextResponse.json({ url })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
