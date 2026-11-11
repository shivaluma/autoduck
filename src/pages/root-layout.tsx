import { useEffect, useRef } from 'react'
import { Link, Outlet, ScrollRestoration, isRouteErrorResponse, useLocation, useMatches, useRouteError, type Params } from 'react-router'

export const DEFAULT_TITLE = 'ĐUA DZỊT — SEASON 3 🦆'
const DEFAULT_DESCRIPTION = 'Vanilla Duck Duck Race, Chaos cards, King of the Pond và secret predictions.'

/** Per-route document metadata, set as `handle: { meta }` in src/router.tsx. */
export type RouteMeta = {
  title?: string | ((params: Params) => string)
  description?: string
}

function useRouteMeta() {
  const matches = useMatches()
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const meta = (matches[index]!.handle as { meta?: RouteMeta } | undefined)?.meta
    if (meta) {
      const title = typeof meta.title === 'function' ? meta.title(matches[index]!.params) : meta.title
      return { title: title ?? DEFAULT_TITLE, description: meta.description ?? DEFAULT_DESCRIPTION }
    }
  }
  return { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION }
}

/** React 19 hoists <title> and <meta> into <head>, so each route sets its own document title. */
function DocumentMeta() {
  const { title, description } = useRouteMeta()
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
    </>
  )
}

/**
 * What Next's App Router did on a client navigation: read the new page title to screen readers (its route
 * announcer) and move focus into the new page. Runs when the path changes, not on the first load and not
 * for `#tab` changes within a page (those keep focus on the tab the user clicked).
 */
function useNavigationAnnouncer() {
  const { pathname, hash } = useLocation()
  const announcerRef = useRef<HTMLParagraphElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousPath = useRef(pathname)

  useEffect(() => {
    if (previousPath.current === pathname) return
    previousPath.current = pathname
    // The hoisted <title> commits with the new route; read it on the next frame.
    const frame = requestAnimationFrame(() => {
      if (announcerRef.current) announcerRef.current.textContent = document.title
      if (!hash) contentRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, hash])

  return { announcerRef, contentRef }
}

export default function RootLayout() {
  const { announcerRef, contentRef } = useNavigationAnnouncer()
  return (
    <>
      <DocumentMeta />
      {/* Top of the page on a new navigation, saved position on back/forward, and `#id` targets. */}
      <ScrollRestoration />
      <div ref={contentRef} tabIndex={-1} className="outline-none">
        <Outlet />
      </div>
      <p ref={announcerRef} aria-live="assertive" aria-atomic="true" className="sr-only" />
    </>
  )
}

/** Shown while the first route module loads. */
export function RootHydrateFallback() {
  return null
}

export function NotFoundPage() {
  // Keep `?token=…`: a mangled magic link that lands here still signs the player in on /season-3.
  const { search } = useLocation()
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center text-white">
      <div className="font-display text-6xl">404</div>
      <p className="text-white/70">Trang này không có trong ao.</p>
      <Link to={{ pathname: '/season-3', search }} className="gx-btn" data-variant="ghost" data-size="sm">Về ao</Link>
    </main>
  )
}

export function RootErrorBoundary() {
  const error = useRouteError()
  const { search } = useLocation()
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error)
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center text-white">
      <title>{`Lỗi — ${DEFAULT_TITLE}`}</title>
      <div className="font-display text-4xl">Có lỗi xảy ra</div>
      <p className="max-w-xl break-words text-white/70">{message}</p>
      {/* A full load (not a client navigation), so a broken build state is dropped; keeps `?token=…`. */}
      <a href={`/season-3${search}`} className="gx-btn" data-variant="ghost" data-size="sm">Về ao</a>
    </main>
  )
}
