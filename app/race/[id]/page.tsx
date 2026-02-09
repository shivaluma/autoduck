'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { RaceStatus } from '@/lib/types'

export default function RaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const resolvedParams = use(params)
  const raceId = resolvedParams.id
  const [race, setRace] = useState<RaceStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(true)

  useEffect(() => {
    const fetchRace = async () => {
      try {
        const res = await fetch(`/api/races/${raceId}`)
        const data = await res.json()
        setRace(data)
        setLoading(false)

        // Stop polling if finished or failed
        if (data.status === 'finished' || data.status === 'failed') {
          setPolling(false)
        }
      } catch {
        setLoading(false)
      }
    }

    fetchRace()

    // Poll every 3 seconds while race is running
    const interval = setInterval(() => {
      if (polling) {
        fetchRace()
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [raceId, polling])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 1: return '🥇'
      case 2: return '🥈'
      case 3: return '🥉'
      default: return `#${rank}`
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-6xl animate-bounce">🦆</div>
          <p className="text-muted-foreground">Đang tải cuộc đua...</p>
        </div>
      </div>
    )
  }

  if (!race) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-6xl">😢</div>
          <p className="text-muted-foreground">Không tìm thấy cuộc đua</p>
          <Link href="/">
            <Button>← Về trang chủ</Button>
          </Link>
        </div>
      </div>
    )
  }

  const isRunning = race.status === 'running'
  const isFinished = race.status === 'finished'
  const isFailed = race.status === 'failed'

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Về trang chủ
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{isRunning ? '🏃' : isFinished ? '🏁' : isFailed ? '❌' : '⏳'}</span>
            <h1 className="text-lg font-bold">Cuộc đua #{raceId}</h1>
            <Badge
              variant={
                isFinished
                  ? 'default'
                  : isRunning
                  ? 'secondary'
                  : isFailed
                  ? 'destructive'
                  : 'outline'
              }
            >
              {race.status === 'pending' ? 'Đang chuẩn bị' : 
               race.status === 'running' ? 'Đang đua!' :
               race.status === 'finished' ? 'Hoàn thành' : 'Thất bại'}
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Running State */}
        {isRunning && (
          <Card className="bg-gradient-to-r from-green-500/10 via-emerald-500/10 to-teal-500/10 border-green-500/30 animate-pulse">
            <CardContent className="pt-6">
              <div className="flex items-center justify-center gap-4">
                <div className="text-5xl animate-bounce">🦆</div>
                <div className="text-center">
                  <h2 className="text-2xl font-bold">Cuộc đua đang diễn ra!</h2>
                  <p className="text-muted-foreground mt-1">
                    Đang theo dõi... trang sẽ tự cập nhật khi có kết quả
                  </p>
                </div>
                <div className="text-5xl animate-bounce" style={{ animationDelay: '0.2s' }}>🦆</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Final Verdict */}
        {isFinished && race.finalVerdict && (
          <Card className="bg-gradient-to-r from-red-500/10 via-orange-500/10 to-amber-500/10 border-red-500/30">
            <CardContent className="pt-6">
              <div className="text-center space-y-3">
                <div className="text-5xl">🧃</div>
                <h2 className="text-2xl font-bold">{race.finalVerdict}</h2>
                <p className="text-sm text-muted-foreground">
                  Kết quả cuối cùng sau khi áp dụng Luật Rừng
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Ranking Table */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Bảng xếp hạng</CardTitle>
              </CardHeader>
              <CardContent>
                {race.participants.length > 0 && race.participants[0].initialRank !== null ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Hạng</TableHead>
                        <TableHead>Tên vịt</TableHead>
                        <TableHead className="text-center">Khiên</TableHead>
                        <TableHead className="text-center">Kết quả</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...race.participants]
                        .sort((a, b) => (a.initialRank ?? 99) - (b.initialRank ?? 99))
                        .map((p) => (
                          <TableRow
                            key={p.userId}
                            className={
                              p.gotScar
                                ? 'bg-red-500/10 hover:bg-red-500/15'
                                : p.usedShield
                                ? 'bg-blue-500/5 hover:bg-blue-500/10'
                                : (p.initialRank ?? 99) <= 3
                                ? 'bg-amber-500/5 hover:bg-amber-500/10'
                                : ''
                            }
                          >
                            <TableCell>
                              <span className="text-xl">
                                {getRankEmoji(p.initialRank ?? 0)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="font-semibold">{p.name}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              {p.usedShield ? (
                                <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                                  🛡️ Có dùng
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {p.gotScar ? (
                                <Badge variant="destructive">
                                  🩸 +1 Sẹo
                                </Badge>
                              ) : p.usedShield && (p.initialRank ?? 0) > race.participants.length - 2 ? (
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                                  ✨ Khiên cứu
                                </Badge>
                              ) : (
                                <Badge variant="secondary">
                                  ✅ An toàn
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">
                      {isRunning ? 'Đang chờ kết quả...' : 'Chưa có kết quả'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Video */}
            {race.videoUrl && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-lg">Video cuộc đua</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                    <video
                      src={race.videoUrl}
                      controls
                      className="w-full h-full rounded-lg"
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Commentary Timeline */}
          <div>
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  🎙️ Bình luận AI
                  {isRunning && (
                    <Badge variant="secondary" className="animate-pulse">
                      LIVE
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  {race.commentaries.length > 0 ? (
                    <div className="space-y-4">
                      {race.commentaries.map((c, idx) => (
                        <div key={idx} className="flex gap-3">
                          <div className="flex-shrink-0 w-14 text-right">
                            <Badge variant="outline" className="font-mono text-xs">
                              {formatTime(c.timestamp)}
                            </Badge>
                          </div>
                          <div className="flex-1">
                            <p className="text-sm leading-relaxed">{c.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <span className="text-3xl">🎙️</span>
                      <p className="text-muted-foreground text-sm mt-2">
                        {isRunning
                          ? 'Đang chờ bình luận...'
                          : 'Chưa có bình luận'}
                      </p>
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Actions */}
        <Separator />
        <div className="flex items-center justify-between">
          <Link href="/">
            <Button variant="outline">← Về trang chủ</Button>
          </Link>
          {isFinished && (
            <Link href="/race/new">
              <Button className="gap-2">
                🦆 Đua lại
              </Button>
            </Link>
          )}
        </div>
      </main>
    </div>
  )
}
