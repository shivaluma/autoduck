'use client'

import { useEffect, useState, useRef } from 'react'
import { Card } from '@/components/ui/card'

interface LivePlayerProps {
  raceId: number
  isFinished?: boolean
}

export function LivePlayer({ raceId, isFinished }: LivePlayerProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [error, setError] = useState<string | null>(null)

  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (isFinished) {
      setStatus('offline')
      return
    }

    // Connect to SSE stream
    const evtSource = new EventSource(`/api/races/${raceId}/live`)

    evtSource.onopen = () => {
      setStatus('live')
      setError(null)
    }

    evtSource.onerror = (err) => {
      console.error('SSE Error:', err)
      // Check if it's a closed connection (race ended) or error
      if (evtSource.readyState === EventSource.CLOSED) {
        setStatus('offline')
      } else {
        // Retry logic is built-in to EventSource usually
        // But we can show temporary error
      }
    }

    evtSource.addEventListener('frame', (event) => {
      try {
        const data = JSON.parse(event.data)
        // Update image directly for performance
        if (imgRef.current) {
          imgRef.current.src = `data:image/jpeg;base64,${data.image}`
        }
        // Also update state if first frame (to hide loading)
        // But continuously updating state causes re-renders, better to use ref for src
        // We set imageSrc once to render the img tag
        if (!imageSrc) setImageSrc(`data:image/jpeg;base64,${data.image}`)
      } catch (e) {
        console.error('Frame parse error', e)
      }
    })

    return () => {
      evtSource.close()
    }
  }, [raceId, isFinished, imageSrc]) // imageSrc dependency is tricky, removed in logic below

  // Refined effect
  useEffect(() => {
    if (isFinished) return

    const evtSource = new EventSource(`/api/races/${raceId}/live`)

    evtSource.onopen = () => setStatus('live')

    evtSource.addEventListener('frame', (event) => {
      const data = JSON.parse(event.data)
      if (imgRef.current) {
        imgRef.current.src = `data:image/jpeg;base64,${data.image}`
        // Show the image element if hidden
        imgRef.current.style.display = 'block'
      }
      setStatus('live')
    })

    return () => evtSource.close()
  }, [raceId, isFinished])

  if (isFinished) return null // Or show "Stream Ended"

  return (
    <Card className="w-full aspect-video bg-black flex items-center justify-center overflow-hidden relative border-2 border-[var(--color-f1-red)] shadow-[0_0_20px_rgba(255,24,1,0.3)]">
      {status === 'connecting' && (
        <div className="text-[var(--color-f1-cyan)] animate-pulse flex flex-col items-center">
          <span className="text-3xl">📡</span>
          <p className="mt-2 text-sm font-mono">CONNECTING SATELLITE...</p>
        </div>
      )}

      {/* Live Badge */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse shadow-lg flex items-center gap-1">
          <div className="w-2 h-2 bg-white rounded-full"></div>
          LIVE
        </div>
        <div className="bg-black/50 text-[var(--color-f1-cyan)] text-xs font-mono px-2 py-1 rounded border border-[var(--color-f1-cyan)]">
          CDP STREAM
        </div>
      </div>

      <img
        ref={imgRef}
        alt="Live Stream"
        className="w-full h-full object-contain"
        style={{ display: 'none' }}
      />
    </Card>
  )
}
