import type { ReactNode } from 'react'
import { PondBackground } from '@/components/game-ui'

/** Every Season 3 page sits in the same pond as the race canvas. */
export default function Season3Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <PondBackground />
      <div className="relative z-[1]">{children}</div>
    </>
  )
}
