import { prisma } from '@/lib/db'
import { replayTrackResponse } from '@/lib/racing/replay-track/serve'

export const dynamic = 'force-dynamic'

// GET /api/races/[id]/track?h=<byteSha256> - recorded DTRK/1 replay track (gzip)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const raceId = Number.parseInt(id, 10)
  if (!Number.isSafeInteger(raceId)) return Response.json({ error: 'Invalid race ID' }, { status: 400 })
  try {
    const row = await prisma.raceReplayTrack.findUnique({
      where: { raceId },
      select: { byteSha256: true, bytes: true },
    })
    return replayTrackResponse(row, {
      h: new URL(request.url).searchParams.get('h'),
      acceptEncoding: request.headers.get('accept-encoding'),
      ifNoneMatch: request.headers.get('if-none-match'),
    })
  } catch (error) {
    console.error('Failed to fetch replay track:', error)
    return Response.json({ error: 'Failed to fetch replay track' }, { status: 500 })
  }
}
