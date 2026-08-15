import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { findUserByGoogle, getActiveSeasonPlayerToken, verifyGoogleToken } from '@/lib/auth/google'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

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
          hasGoogle: Boolean(player.user.googleId || player.user.email),
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
    const body = (await request.json()) as {
      action?: 'login' | 'bind' | 'unbind'
      credential?: string
      token?: string
      email?: string
      googleId?: string
    }

    const action = body.action ?? 'login'

    // ==========================================
    // ACTION: UNBIND
    // ==========================================
    if (action === 'unbind') {
      if (!body.token) {
        return NextResponse.json({ error: 'Token là bắt buộc' }, { status: 400 })
      }
      const player = await prisma.seasonPlayer.findUnique({
        where: { accessToken: body.token },
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
    // EXTRACT GOOGLE PROFILE
    // ==========================================
    const tokenInput = body.credential || body.email || body.googleId || ''
    if (!tokenInput) {
      return NextResponse.json({ error: 'Thiếu thông tin xác thực Google' }, { status: 400 })
    }

    const googleProfile = await verifyGoogleToken(tokenInput)
    if (!googleProfile || (!googleProfile.googleId && !googleProfile.email)) {
      return NextResponse.json({ error: 'Không thể xác thực thông tin tài khoản Google' }, { status: 400 })
    }

    // ==========================================
    // ACTION: BIND
    // ==========================================
    if (action === 'bind') {
      if (!body.token) {
        return NextResponse.json({ error: 'Token là bắt buộc để liên kết' }, { status: 400 })
      }
      const player = await prisma.seasonPlayer.findUnique({
        where: { accessToken: body.token },
        include: { user: true },
      })
      if (!player) {
        return NextResponse.json({ error: 'Token không hợp lệ' }, { status: 401 })
      }

      // Check if this google account is already bound to another user
      const existingUser = await findUserByGoogle(googleProfile.googleId, googleProfile.email)
      if (existingUser && existingUser.id !== player.userId) {
        return NextResponse.json(
          { error: `Tài khoản Google (${googleProfile.email ?? googleProfile.googleId}) đã được liên kết với chú Dzịt "${existingUser.name}".` },
          { status: 409 },
        )
      }

      // Update current user
      const updatedUser = await prisma.user.update({
        where: { id: player.userId },
        data: {
          googleId: googleProfile.googleId,
          email: googleProfile.email ? googleProfile.email.toLowerCase().trim() : player.user.email,
          avatarUrl: player.user.avatarUrl || googleProfile.picture || null,
        },
      })

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
    // ACTION: LOGIN
    // ==========================================
    const matchedUser = await findUserByGoogle(googleProfile.googleId, googleProfile.email)

    if (!matchedUser) {
      return NextResponse.json(
        {
          error: `Tài khoản Google (${googleProfile.email ?? googleProfile.googleId}) chưa được liên kết với chú Dzịt nào. Hãy đăng nhập bằng Secret Link một lần rồi bấm "Liên kết Google" để kích hoạt nhé!`,
          email: googleProfile.email,
        },
        { status: 404 },
      )
    }

    // Update googleId or avatar if missing
    if (!matchedUser.googleId && googleProfile.googleId) {
      await prisma.user.update({
        where: { id: matchedUser.id },
        data: {
          googleId: googleProfile.googleId,
          avatarUrl: matchedUser.avatarUrl || googleProfile.picture || null,
        },
      })
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
