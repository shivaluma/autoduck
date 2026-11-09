import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  GoogleKeysUnavailableError,
  findUserByGoogle,
  getActiveSeasonPlayerToken,
  googleAudiences,
  googleClientId,
  hasGoogleLink,
  verifyGoogleIdToken,
} from '@/lib/auth/google'

const ACTIONS = ['login', 'bind', 'unbind'] as const
type Action = (typeof ACTIONS)[number]

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}

const ALREADY_LINKED = 'Tài khoản Google này đã được liên kết với một chú Dzịt khác.'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    const clientId = googleClientId()

    let boundInfo = null
    if (token) {
      const player = await prisma.seasonPlayer.findUnique({
        where: { accessToken: token },
        include: { user: true },
      })
      if (player?.user) {
        boundInfo = {
          userId: player.user.id,
          name: player.user.name,
          email: player.user.email,
          hasGoogle: hasGoogleLink(player.user.googleId),
        }
      }
    }

    return NextResponse.json({
      clientId,
      isConfigured: Boolean(clientId),
      bound: boundInfo,
    })
  } catch (error) {
    console.error('Google Auth GET error:', error)
    return NextResponse.json({ error: 'Không lấy được cấu hình Google Auth' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: 'Yêu cầu không hợp lệ' }, { status: 400 })
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return NextResponse.json({ error: 'Yêu cầu không hợp lệ' }, { status: 400 })
    }
    const body = raw as { action?: unknown; credential?: unknown; token?: unknown }

    const action: Action | null = body.action === undefined ? 'login' : ACTIONS.find((value) => value === body.action) ?? null
    if (!action) {
      return NextResponse.json({ error: 'Hành động không hợp lệ' }, { status: 400 })
    }
    const playerToken = typeof body.token === 'string' ? body.token : ''

    // ==========================================
    // ACTION: UNBIND
    // ==========================================
    if (action === 'unbind') {
      if (!playerToken) {
        return NextResponse.json({ error: 'Token là bắt buộc' }, { status: 400 })
      }
      const player = await prisma.seasonPlayer.findUnique({
        where: { accessToken: playerToken },
        include: { user: true },
      })
      if (!player) {
        return NextResponse.json({ error: 'Token không hợp lệ' }, { status: 401 })
      }

      await prisma.user.update({
        where: { id: player.userId },
        data: { googleId: null, email: null },
      })

      return NextResponse.json({
        ok: true,
        message: 'Đã hủy liên kết tài khoản Google thành công.',
      })
    }

    // ==========================================
    // VERIFY GOOGLE ID TOKEN
    // ==========================================
    const audience = googleAudiences()
    if (audience.length === 0) {
      console.error('Google sign-in is not configured: set GOOGLE_CLIENT_ID.')
      return NextResponse.json({ error: 'Đăng nhập Google chưa được cấu hình.' }, { status: 503 })
    }

    if (typeof body.credential !== 'string' || !body.credential.trim()) {
      return NextResponse.json({ error: 'Thiếu thông tin xác thực Google' }, { status: 400 })
    }

    let googleProfile
    try {
      googleProfile = await verifyGoogleIdToken(body.credential, { audience })
    } catch (error) {
      if (error instanceof GoogleKeysUnavailableError) {
        console.error('Could not fetch Google signing keys:', error.message)
        return NextResponse.json({ error: 'Không kết nối được Google. Vui lòng thử lại sau.' }, { status: 503 })
      }
      throw error
    }
    if (!googleProfile) {
      return NextResponse.json({ error: 'Không thể xác thực thông tin tài khoản Google' }, { status: 401 })
    }

    // ==========================================
    // ACTION: BIND
    // ==========================================
    if (action === 'bind') {
      if (!playerToken) {
        return NextResponse.json({ error: 'Token là bắt buộc để liên kết' }, { status: 400 })
      }
      const player = await prisma.seasonPlayer.findUnique({
        where: { accessToken: playerToken },
        include: { user: true },
      })
      if (!player) {
        return NextResponse.json({ error: 'Token không hợp lệ' }, { status: 401 })
      }

      // One Google account per duck.
      const linkedElsewhere = await prisma.user.findFirst({
        where: { googleId: googleProfile.googleId, id: { not: player.userId } },
        select: { id: true },
      })
      if (linkedElsewhere) {
        console.warn(`Google bind refused: sub already linked to user ${linkedElsewhere.id}, requested by user ${player.userId}`)
        return NextResponse.json({ error: ALREADY_LINKED }, { status: 409 })
      }

      // Store the verified email only when Google verified it and no other duck already uses it.
      let email = player.user.email
      if (googleProfile.email && googleProfile.emailVerified) {
        const emailOwner = await prisma.user.findFirst({
          where: { email: googleProfile.email, id: { not: player.userId } },
          select: { id: true },
        })
        if (!emailOwner) email = googleProfile.email
      }

      let updatedUser
      try {
        updatedUser = await prisma.user.update({
          where: { id: player.userId },
          data: {
            googleId: googleProfile.googleId,
            email,
            avatarUrl: player.user.avatarUrl || googleProfile.picture || null,
          },
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) return NextResponse.json({ error: ALREADY_LINKED }, { status: 409 })
        throw error
      }

      return NextResponse.json({
        ok: true,
        message: `Đã liên kết tài khoản Google (${googleProfile.email ?? googleProfile.name ?? 'thành công'}) với Dzịt ${updatedUser.name}!`,
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
        },
      })
    }

    // ==========================================
    // ACTION: LOGIN (by verified Google id only)
    // ==========================================
    const matchedUser = await findUserByGoogle(googleProfile)

    if (!matchedUser) {
      return NextResponse.json(
        {
          error: 'Tài khoản Google này chưa được liên kết với chú Dzịt nào. Hãy đăng nhập bằng Secret Link một lần rồi bấm "Liên kết Google" để kích hoạt nhé!',
        },
        { status: 404 },
      )
    }

    // Get active season token
    const accessToken = await getActiveSeasonPlayerToken(matchedUser.id)
    if (!accessToken) {
      return NextResponse.json(
        { error: `Chú Dzịt "${matchedUser.name}" chưa tham gia Season 3 đang mở. Vui lòng liên hệ Admin.` },
        { status: 403 },
      )
    }

    return NextResponse.json({
      ok: true,
      message: `Đăng nhập thành công! Chào mừng Dzịt ${matchedUser.name}! 🦆`,
      token: accessToken,
      user: {
        id: matchedUser.id,
        name: matchedUser.name,
        email: matchedUser.email,
      },
    })
  } catch (error) {
    console.error('Google Auth POST error:', error)
    return NextResponse.json({ error: 'Đã xảy ra lỗi khi xử lý đăng nhập Google.' }, { status: 500 })
  }
}
