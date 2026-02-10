import { NewRaceContent } from './content'

interface PageProps {
  searchParams: Promise<{ test?: string; secret?: string }>
}

export default async function NewRacePage({ searchParams }: PageProps) {
  const params = await searchParams
  const testMode = params.test === 'true'
  const secretKey = params.secret

  return <NewRaceContent testMode={testMode} secretKey={secretKey} />
}
