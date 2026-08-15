'use client'

import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            auto_select?: boolean
            cancel_on_tap_outside?: boolean
          }) => void
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: 'standard' | 'icon'
              theme?: 'outline' | 'filled_blue' | 'filled_black'
              size?: 'large' | 'medium' | 'small'
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
              shape?: 'rectangular' | 'pill' | 'circle' | 'square'
              logo_alignment?: 'left' | 'center'
              width?: string | number
            },
          ) => void
          prompt: () => void
        }
      }
    }
  }
}

interface GoogleAuthButtonProps {
  mode: 'login' | 'bind'
  token?: string
  boundEmail?: string | null
  onSuccess: (result: { token?: string; user?: { id: number; name: string; email?: string | null }; message?: string }) => void
  onError?: (errorMessage: string) => void
  className?: string
}

export function GoogleAuthButton({
  mode,
  token,
  boundEmail,
  onSuccess,
  onError,
  className = '',
}: GoogleAuthButtonProps) {
  const [clientId, setClientId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [unbinding, setUnbinding] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showDirectInput, setShowDirectInput] = useState(false)
  const [directEmail, setDirectEmail] = useState('')
  const buttonRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 1. Fetch client ID if not in public env
    const envClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''
    if (envClientId) {
      setClientId(envClientId)
    } else {
      void fetch('/api/auth/google')
        .then((res) => res.json())
        .then((data: { clientId?: string }) => {
          if (data.clientId) setClientId(data.clientId)
        })
        .catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!clientId) return

    // 2. Dynamically load Google GSI script
    if (!window.google?.accounts?.id) {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => {
        initGoogleButton()
      }
      document.body.appendChild(script)
    } else {
      initGoogleButton()
    }

    function initGoogleButton() {
      if (!window.google?.accounts?.id || !buttonRef.current) return

      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response: { credential: string }) => {
            void handleCredential(response.credential)
          },
        })

        buttonRef.current.innerHTML = ''
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'filled_black',
          size: 'large',
          text: mode === 'bind' ? 'continue_with' : 'signin_with',
          shape: 'pill',
          width: '100%',
        })
      } catch (err) {
        console.error('Failed to render Google button:', err)
      }
    }
  }, [clientId, mode, token])

  async function handleCredential(credentialOrEmail: string) {
    setLoading(true)
    setErrorMsg('')

    try {
      const endpoint = '/api/auth/google'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: mode,
          token: mode === 'bind' ? token : undefined,
          credential: credentialOrEmail,
        }),
      })

      const data = (await response.json()) as {
        ok?: boolean
        token?: string
        user?: { id: number; name: string; email?: string | null }
        message?: string
        error?: string
      }

      if (!response.ok || !data.ok) {
        const message = data.error || 'Xác thực Google thất bại'
        setErrorMsg(message)
        onError?.(message)
        return
      }

      onSuccess({
        token: data.token,
        user: data.user,
        message: data.message,
      })
      setShowDirectInput(false)
    } catch {
      const message = 'Lỗi kết nối máy chủ khi xác thực Google.'
      setErrorMsg(message)
      onError?.(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUnbind() {
    if (!token) return
    setUnbinding(true)
    setErrorMsg('')
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unbind',
          token,
        }),
      })
      const data = (await response.json()) as { ok?: boolean; message?: string; error?: string }
      if (response.ok && data.ok) {
        onSuccess({ message: data.message })
      } else {
        setErrorMsg(data.error || 'Không thể hủy liên kết Google')
      }
    } catch {
      setErrorMsg('Lỗi kết nối khi hủy liên kết Google')
    } finally {
      setUnbinding(false)
    }
  }

  function handleDirectSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!directEmail.trim()) return
    void handleCredential(directEmail.trim())
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* If bound in bind-mode */}
      {mode === 'bind' && boundEmail ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-[var(--color-ggd-neon-green)]/40 bg-[var(--color-ggd-neon-green)]/10 p-4">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">✓</span>
            <div>
              <div className="text-[10px] font-black tracking-wider text-[var(--color-ggd-neon-green)]">
                ĐÃ LIÊN KẾT GOOGLE
              </div>
              <div className="font-bold text-white/90 text-sm">{boundEmail}</div>
            </div>
          </div>
          <button
            type="button"
            disabled={unbinding}
            onClick={() => void handleUnbind()}
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40"
          >
            {unbinding ? 'Đang hủy...' : 'Hủy liên kết'}
          </button>
        </div>
      ) : (
        <>
          {/* Official Google GSI Render Container (when clientId configured) */}
          <div className="flex justify-center" ref={buttonRef} />

          {/* Fallback button if GSI element isn't rendered or direct action */}
          {(!clientId || !buttonRef.current?.hasChildNodes()) && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  if (window.google?.accounts?.id && clientId) {
                    window.google.accounts.id.prompt()
                  } else {
                    setShowDirectInput(!showDirectInput)
                  }
                }}
                className="flex w-full items-center justify-center gap-3 rounded-xl border-2 border-white/20 bg-white/10 px-4 py-3 font-display text-sm font-bold text-white transition hover:border-[var(--color-ggd-neon-green)] hover:bg-white/15"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.3 8.9 5 12 5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.3 14.7c-.2-.7-.4-1.5-.4-2.7 0-1.1.2-1.9.4-2.7L1.6 6.4C.6 8.3 0 10.5 0 12.7s.6 4.4 1.6 6.3l3.7-4.3z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.3-6.7-5.3L1.6 16.4C3.5 20.2 7.4 23.5 12 23.5z"
                  />
                </svg>
                <span>
                  {loading
                    ? 'Đang xác thực...'
                    : mode === 'bind'
                      ? '🔗 Liên kết với Google'
                      : 'Đăng nhập bằng Google'}
                </span>
              </button>

              {showDirectInput && (
                <form onSubmit={handleDirectSubmit} className="flex gap-2 pt-1">
                  <input
                    type="email"
                    placeholder="Nhập Gmail để liên kết/đăng nhập"
                    value={directEmail}
                    onChange={(e) => setDirectEmail(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-[var(--color-ggd-neon-green)] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!directEmail.trim() || loading}
                    className="rounded-lg bg-[var(--color-ggd-neon-green)] px-3 py-2 text-xs font-black text-[var(--color-ggd-outline)] disabled:opacity-40"
                  >
                    Xác nhận
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}

      {/* Error display */}
      {errorMsg && (
        <p className="text-center text-xs font-bold text-rose-400 bg-rose-500/10 rounded-lg p-2 border border-rose-500/20">
          ⚠️ {errorMsg}
        </p>
      )}
    </div>
  )
}
