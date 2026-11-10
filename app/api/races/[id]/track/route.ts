import { prisma } from '@/lib/db'
import { replayTrackResponse } from '@/lib/racing/replay-track/serve'
import { parseRaceIdParam } from '@/lib/racing/race-id'

export const dynamic = 'force-dynamic'

// GET /api/races/[id]/track?h=<byteSha256> - recorded DTRK/1 replay track (gzip)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsedId = parseRaceIdParam((await params).id)
  if (!parsedId.ok) {
    return parsedId.status === 400
      ? Response.json({ error: 'Invalid race ID' }, { status: 400 })
      : replayTrackResponse(null, { h: null, acceptEncoding: null, ifNoneMatch: null })
  }
  const { raceId } = parsedId
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
