'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { getWildItem } from '@/packages/race-core/src'
import type { WildItemId } from '@/packages/race-protocol/src'

type LiveDuck = {
  rank: number
  progress: number
  activeEffects: string[]
  wildItem: { instanceId: string; itemId: WildItemId; acquiredAtTick: number } | null
  regularPickupCount: number
}

type LiveResponse = {
  status: string
  engineState: string
  manualUseEnabled: boolean
  autoUseEnabled: boolean
  duck: LiveDuck | null
  latestAction?: { wildItemInstanceId: string; status: string; resultJson?: string | null } | null
  error?: string
}

function actionMessage(action: LiveResponse['latestAction']) {
  if (!action) return ''
  if (action.status === 'PENDING' || action.status === 'QUEUED') return 'Đang gửi vào race...'
  if (action.status === 'APPLIED') return 'Đã dùng!'
  if (!action.resultJson) return 'Không dùng được.'
  try {
    const result = JSON.parse(action.resultJson) as { reason?: string }
    if (result.reason === 'NO_TARGET') return 'Chưa có mục tiêu trong tầm.'
    if (result.reason === 'ITEM_CHANGED') return 'Item đã được auto-use.'
    if (result.reason === 'RACE_FINISHED') return 'Race đã kết thúc.'
  } catch {
    // Keep the concise fallback below.
  }
  return 'Không dùng được.'
}

export function LiveWildItemPanel({ raceId, token, isTest = false }: { raceId: number; token: string; isTest?: boolean }) {
  const [live, setLive] = useState<LiveResponse | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [requestError, setRequestError] = useState('')

  const load = useCallback(async () => {
    const response = await fetch(`/api/races/${raceId}/wild-item?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    if (!response.ok) return
    setLive(await response.json() as LiveResponse)
  }, [raceId, token])

  const shouldPoll = !live || (live.status === 'running' && live.engineState === 'RACING')
  useEffect(() => {
    if (!shouldPoll) return
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      await load()
      if (!cancelled) timer = window.setTimeout(() => void poll(), 500)
    }
    timer = window.setTimeout(() => void poll(), 0)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [load, shouldPoll])

  const item = live?.duck?.wildItem ? getWildItem(live.duck.wildItem.itemId) : null

  async function activateNow() {
    const wildItem = live?.duck?.wildItem
    if (!wildItem || submitting) return
    setSubmitting(true)
    setRequestError('')
    const response = await fetch(`/api/races/${raceId}/wild-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, wildItemInstanceId: wildItem.instanceId, clientActionId: crypto.randomUUID() }),
    })
    const result = await response.json() as { error?: string }
    if (!response.ok) setRequestError(result.error ?? 'Không dùng được item.')
    await load()
    setSubmitting(false)
  }

  const progress = Math.round((live?.duck?.progress ?? 0) * 100)
  const effects = live?.duck?.activeEffects ?? []
  const currentInstanceId = live?.duck?.wildItem?.instanceId
  const currentAction = live?.latestAction?.wildItemInstanceId === currentInstanceId ? live?.latestAction ?? null : null
  const message = requestError || actionMessage(currentAction)

  return <Card className="border-primary/40 bg-card/95 shadow-lg">
    <CardHeader>
      <div>
        <Badge variant={isTest ? 'secondary' : 'default'}>{isTest ? 'TEST RACE' : 'LIVE RACE'}</Badge>
        <CardTitle className="mt-3 font-display text-3xl">🎒 Wild Slot</CardTitle>
        <CardDescription>Canh thời điểm hoặc để dzịt tự dùng.</CardDescription>
      </div>
      <CardAction><Badge variant="outline">#{live?.duck?.rank ?? '—'}</Badge></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 text-sm"><span>Tiến độ</span><strong>{progress}%</strong></div>
      <Progress value={progress} aria-label={`Race progress ${progress}%`} />
      {item && live?.duck?.wildItem ? <div className="flex items-center gap-4 rounded-xl border bg-background/50 p-4">
        <span className="text-5xl" aria-hidden>{item.icon}</span>
        <div className="min-w-0 flex-1"><div className="font-display text-2xl">{item.displayName}</div><p className="text-sm text-muted-foreground">{item.description}</p></div>
      </div> : <div className="rounded-xl border border-dashed bg-background/30 p-4 text-center text-sm text-muted-foreground">Chưa giữ Wild Item.</div>}
      {effects.length > 0 && <div className="flex flex-wrap gap-2">{effects.map((effect) => <Badge key={effect} variant="secondary">{effect.replaceAll('_', ' ')}</Badge>)}</div>}
      {message && <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p>}
    </CardContent>
    <CardFooter className="flex gap-3">
      <Button size="lg" className="flex-1" disabled={!live?.manualUseEnabled || !live?.duck?.wildItem || submitting || live?.status !== 'running' || live?.engineState !== 'RACING'} onClick={() => void activateNow()}>
        {submitting ? 'ĐANG GỬI...' : 'USE NOW'}
      </Button>
      <Badge variant="outline">AUTO-USE {live?.autoUseEnabled ? 'ON' : 'OFF'}</Badge>
    </CardFooter>
  </Card>
}
