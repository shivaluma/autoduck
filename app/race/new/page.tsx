import { Suspense } from 'react'
import { NewRaceContent } from './content'

export default function NewRacePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[var(--color-f1-dark)] flex items-center justify-center">
        <div className="text-4xl animate-spin text-white">🦆</div>
      </div>
    }>
      <NewRaceContent />
    </Suspense>
  )
}
