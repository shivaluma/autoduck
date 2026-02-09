'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { PlayerData } from '@/lib/types'

export default function Dashboard() {
  const [players, setPlayers] = useState<PlayerData[]>([])
  const [loading, setLoading] = useState(true)
  const [races, setRaces] = useState<{ id: number; status: string; finalVerdict: string | null; createdAt: string }[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/races').then((r) => r.json()),
    ]).then(([usersData, racesData]) => {
      setPlayers(usersData)
      setRaces(racesData)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const totalRaces = races.length
  const totalKhaos = players.reduce((sum, p) => sum + p.totalKhaos, 0)
  const mostKhaos = players.length > 0
    ? [...players].sort((a, b) => b.totalKhaos - a.totalKhaos)[0]
    : null

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🦆</span>
            <div>
              <h1 className="text-xl font-bold tracking-tight">AutoDuck</h1>
              <p className="text-xs text-muted-foreground">Zero-Touch Duck Racing</p>
            </div>
          </div>
          <Link href="/race/new">
            <Button size="lg" className="font-semibold gap-2">
              <span>🏁</span> Bắt đầu cuộc đua
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tổng người chơi
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{players.length}</div>
              <p className="text-xs text-muted-foreground mt-1">Zịt team members</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tổng cuộc đua
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalRaces}</div>
              <p className="text-xs text-muted-foreground mt-1">Sáng thứ 2 hàng tuần</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-500/10 to-pink-500/10 border-red-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tổng lượt khao nước
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalKhaos}</div>
              <p className="text-xs text-muted-foreground mt-1">Bao nhiêu ly nước rồi</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/10 border-purple-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Vua khao nước
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{mostKhaos?.name?.replace('Zịt ', '') || '—'}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {mostKhaos ? `${mostKhaos.totalKhaos} lần khao` : 'Chưa có ai'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Player Leaderboard */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Bảng xếp hạng Team Zịt</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Sẹo, Khiên và lịch sử khao nước
                </p>
              </div>
              <Badge variant="outline" className="font-mono">
                Quy tắc: 2 Sẹo = 1 Khiên
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin text-4xl">🦆</div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Tên</TableHead>
                    <TableHead className="text-center">
                      <span title="Sẹo hiện tại">🩸 Sẹo</span>
                    </TableHead>
                    <TableHead className="text-center">
                      <span title="Khiên hiện có">🛡️ Khiên</span>
                    </TableHead>
                    <TableHead className="text-center">
                      <span title="Khiên đã sử dụng">⚔️ Khiên đã dùng</span>
                    </TableHead>
                    <TableHead className="text-center">
                      <span title="Tổng lần khao nước">🧃 Khao nước</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...players]
                    .sort((a, b) => b.totalKhaos - a.totalKhaos)
                    .map((player, idx) => (
                      <TableRow
                        key={player.id}
                        className={
                          idx === 0
                            ? 'bg-red-500/5 hover:bg-red-500/10'
                            : undefined
                        }
                      >
                        <TableCell className="font-mono text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-lg">
                              {idx === 0 ? '👑' : '🦆'}
                            </span>
                            <span className="font-semibold">{player.name}</span>
                            {idx === 0 && (
                              <Badge variant="destructive" className="text-[10px]">
                                Vua khao
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={player.scars > 0 ? 'destructive' : 'secondary'}
                            className="font-mono min-w-[2rem]"
                          >
                            {player.scars}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={player.shields > 0 ? 'default' : 'secondary'}
                            className="font-mono min-w-[2rem]"
                          >
                            {player.shields}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="font-mono text-muted-foreground">
                            {player.shieldsUsed}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="font-mono font-bold text-lg">
                            {player.totalKhaos}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Recent Races */}
        {races.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Lịch sử cuộc đua</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {races.slice(0, 10).map((race) => (
                  <Link
                    key={race.id}
                    href={`/race/${race.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">
                        {race.status === 'finished' ? '✅' : race.status === 'running' ? '🏃' : race.status === 'failed' ? '❌' : '⏳'}
                      </span>
                      <div>
                        <p className="font-medium text-sm">Cuộc đua #{race.id}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(race.createdAt).toLocaleDateString('vi-VN', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {race.finalVerdict && (
                        <Badge variant="outline" className="text-xs max-w-[300px] truncate">
                          {race.finalVerdict}
                        </Badge>
                      )}
                      <Badge
                        variant={
                          race.status === 'finished'
                            ? 'default'
                            : race.status === 'running'
                            ? 'secondary'
                            : race.status === 'failed'
                            ? 'destructive'
                            : 'outline'
                        }
                      >
                        {race.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <Separator />
        <footer className="text-center text-sm text-muted-foreground py-4">
          <p>AutoDuck v1.0 - Zero-Touch Duck Racing System</p>
          <p className="text-xs mt-1">Powered by Team Web 🦆 | Sáng thứ 2 hàng tuần</p>
        </footer>
      </main>
    </div>
  )
}
