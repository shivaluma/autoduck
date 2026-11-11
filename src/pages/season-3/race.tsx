import { useParams } from 'react-router'
import { Season3RaceView } from '@/components/season3-race-view'
import { NotFoundPage } from '@/src/pages/root-layout'

export default function Season3RacePage() {
  const { id = '' } = useParams<{ id: string }>()
  // Race ids are positive integers; anything else (`abc`, `42.5`) is a 404, as on the Rust server.
  if (!/^[1-9]\d*$/.test(id)) return <NotFoundPage />
  // Keyed by id so moving between races starts a fresh view (as a new dynamic segment did in Next).
  return <Season3RaceView key={id} raceId={Number(id)} />
}
