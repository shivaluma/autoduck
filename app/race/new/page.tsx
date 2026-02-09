'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { PlayerData } from '@/lib/types'

interface ParticipantSetup {
  userId: number
  name: string
  selected: boolean
  useShield: boolean
  availableShields: number
}

export default function NewRacePage() {
  const router = useRouter()
  const [players, setPlayers] = useState<ParticipantSetup[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data: PlayerData[]) => {
        setPlayers(
          data.map((p) => ({
            userId: p.id,
            name: p.name,
            selected: true,
            useShield: false,
            availableShields: p.shields,
          }))
        )
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const selectedCount = players.filter((p) => p.selected).length
  const shieldsInUse = players.filter((p) => p.selected && p.useShield).length

  const handleTogglePlayer = (userId: number) => {
    setPlayers((prev) =>
      prev.map((p) =>
        p.userId === userId
          ? { ...p, selected: !p.selected, useShield: !p.selected ? false : p.useShield }
          : p
      )
    )
  }

  const handleToggleShield = (userId: number) => {
    setPlayers((prev) =>
      prev.map((p) =>
        p.userId === userId ? { ...p, useShield: !p.useShield } : p
      )
    )
  }

  const handleSelectAll = () => {
    const allSelected = players.every((p) => p.selected)
    setPlayers((prev) =>
      prev.map((p) => ({
        ...p,
        selected: !allSelected,
        useShield: !allSelected ? p.useShield : false,
      }))
    )
  }

  const handleStartRace = async () => {
    setStarting(true)
    setError(null)

    const participants = players
      .filter((p) => p.selected)
      .map((p) => ({
        userId: p.userId,
        useShield: p.useShield,
      }))

    try {
      const res = await fetch('/api/races/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Có lỗi xảy ra')
        setStarting(false)
        return
      }

      // Navigate to race status page
      router.push(`/race/${data.raceId}`)
    } catch {
      setError('Không thể kết nối server')
      setStarting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              ← Quay lại
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">🦆</span>
            <h1 className="text-xl font-bold tracking-tight">Thiết lập cuộc đua</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Info Banner */}
        <Card className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 border-amber-500/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <span className="text-4xl">🏁</span>
              <div>
                <h2 className="font-bold text-lg">Chuẩn bị cuộc đua mới</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Chọn người chơi tham gia và ai sẽ sử dụng khiên. 
                  Nhớ: 2 người cuối bảng sẽ phải khao nước!
                </p>
                <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                  <span>🩸 Sẹo = Bị phạt</span>
                  <span>🛡️ Khiên = Miễn phạt 1 lần</span>
                  <span>📏 2 Sẹo → 1 Khiên</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Player Selection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Chọn người chơi</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedCount} người được chọn • {shieldsInUse} khiên được dùng
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleSelectAll}>
                {players.every((p) => p.selected) ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
              </Button>
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
                    <TableHead className="w-12">Chọn</TableHead>
                    <TableHead>Người chơi</TableHead>
                    <TableHead className="text-center">🩸 Sẹo</TableHead>
                    <TableHead className="text-center">🛡️ Khiên có</TableHead>
                    <TableHead className="text-center">Dùng Khiên?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {players.map((player) => (
                    <TableRow
                      key={player.userId}
                      className={
                        player.selected
                          ? player.useShield
                            ? 'bg-blue-500/5'
                            : ''
                          : 'opacity-50'
                      }
                    >
                      <TableCell>
                        <Checkbox
                          checked={player.selected}
                          onCheckedChange={() => handleTogglePlayer(player.userId)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🦆</span>
                          <span className="font-semibold">{player.name}</span>
                          {player.useShield && (
                            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                              🛡️ Đang dùng khiên
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={player.availableShields > 0 ? 'secondary' : 'destructive'}
                          className="font-mono"
                        >
                          {/* Show current scars based on available data */}
                          —
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={player.availableShields > 0 ? 'default' : 'secondary'}
                          className="font-mono"
                        >
                          {player.availableShields}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={player.useShield}
                          onCheckedChange={() => handleToggleShield(player.userId)}
                          disabled={
                            !player.selected || player.availableShields <= 0
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="pt-6">
              <p className="text-destructive font-medium">⚠️ {error}</p>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between">
          <Link href="/">
            <Button variant="outline" size="lg">
              ← Hủy
            </Button>
          </Link>
          <Button
            size="lg"
            className="font-bold text-lg gap-2 px-8"
            onClick={handleStartRace}
            disabled={selectedCount < 2 || starting}
          >
            {starting ? (
              <>
                <span className="animate-spin">🦆</span> Đang khởi tạo...
              </>
            ) : (
              <>
                🏁 BẮT ĐẦU ĐUA ({selectedCount} vịt)
              </>
            )}
          </Button>
        </div>

        {/* Shield Usage Summary */}
        {shieldsInUse > 0 && (
          <Card className="bg-blue-500/5 border-blue-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🛡️</span>
                <h3 className="font-semibold">Khiên đang được dùng</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {players
                  .filter((p) => p.selected && p.useShield)
                  .map((p) => (
                    <Badge key={p.userId} className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                      {p.name}
                    </Badge>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Nếu những người này về cuối bảng, họ sẽ được miễn phạt. Phạt sẽ chuyển cho người kế tiếp.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
