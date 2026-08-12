import { Season3RaceView } from '@/components/season3-race-view'

export default async function Season3RacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <Season3RaceView raceId={Number(id)} />
}
