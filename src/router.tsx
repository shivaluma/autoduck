/**
 * Route table of the SPA (plan D18, Phase 4). Every page is a lazy route, so a page's chunk holds only what
 * it imports: the home and rules routes never load Phaser or the race engine (CI checks the build manifest).
 *
 * Old URLs from the legacy v2 app redirect as next.config.ts did, and every redirect keeps `?search` and
 * `#hash`: `/?token=…` → `/season-3?token=…` is how magic links sign players in.
 */
import type { ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import RootLayout, { NotFoundPage, RootErrorBoundary, RootHydrateFallback, type RouteMeta } from '@/src/pages/root-layout'
import { RedirectTo } from '@/src/redirect'

/** A page module: the default export is the page; `meta` (optional) sets its title when the route doesn't. */
type PageModule = { default: ComponentType; meta?: RouteMeta }

/** A lazy route. Static `meta` wins; otherwise the module's own `meta` export, if any, is used. */
function page(load: () => Promise<PageModule>, meta?: RouteMeta) {
  return {
    lazy: async () => {
      const mod = await load()
      return { Component: mod.default, ...(!meta && mod.meta ? { handle: { meta: mod.meta } } : {}) }
    },
    handle: meta ? { meta } : undefined,
  }
}

const S3 = 'ĐUA DZỊT S3'
const NOT_FOUND_TITLE = `Không tìm thấy — ${S3}`

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    ErrorBoundary: RootErrorBoundary,
    HydrateFallback: RootHydrateFallback,
    children: [
      { index: true, ...page(() => import('@/src/pages/home')) },
      {
        path: 'season-3',
        ...page(() => import('@/src/pages/season-3/layout')),
        children: [
          { index: true, ...page(() => import('@/src/pages/season-3/index')) },
          // Title and description come from the module (they live with the rules content).
          { path: 'rules', ...page(() => import('@/src/pages/season-3/rules')) },
          { path: 'race/:id', ...page(() => import('@/src/pages/season-3/race'), { title: (params) => (/^[1-9]\d*$/.test(params.id ?? '') ? `Race #${params.id} — ${S3}` : NOT_FOUND_TITLE) }) },
          { path: 'duck/:userId', ...page(() => import('@/src/pages/season-3/duck'), { title: `Hồ sơ vịt — ${S3}` }) },
        ],
      },
      { path: 'admin/season-3', ...page(() => import('@/src/pages/admin/season-3'), { title: `Race Desk — ${S3}` }) },
      { path: 'admin/cosmetics', ...page(() => import('@/src/pages/admin/cosmetics'), { title: `Quản lý shop — ${S3}` }) },
      { path: 'dev/race-lab', ...page(() => import('@/src/pages/dev/race-lab'), { title: `Race Lab — ${S3}` }) },
      { path: 'dev/race-fx', ...page(() => import('@/src/pages/dev/race-fx'), { title: `Race FX gallery — ${S3}` }) },
      { path: 'dev/cosmetics', ...page(() => import('@/src/pages/dev/cosmetics'), { title: `Cosmetic Gallery — ${S3}` }) },
      { path: 'dev/avatar-matrix', ...page(() => import('@/src/pages/dev/avatar-matrix'), { title: `Avatar matrix — ${S3}` }) },
      { path: 'dev/avatar-showcase', ...page(() => import('@/src/pages/dev/avatar-showcase'), { title: `Avatar showcase — ${S3}` }) },
      { path: 'dev/avatar-compatibility', ...page(() => import('@/src/pages/dev/avatar-compatibility'), { title: `Avatar compatibility — ${S3}` }) },

      // Legacy v2 URLs (were `redirects()` in next.config.ts).
      { path: 'rules', element: <RedirectTo to="/season-3/rules" /> },
      { path: 'admin/dashboard', element: <RedirectTo to="/admin/season-3" /> },
      { path: 'dragon', element: <RedirectTo to="/season-3" /> },
      { path: 'members', element: <RedirectTo to="/season-3" /> },
      { path: 'race/new', element: <RedirectTo to="/season-3" /> },
      // Re-encode the id (as Next did): a decoded `?` or `#` must not become part of the target URL.
      { path: 'race/:id', element: <RedirectTo to={(params) => `/season-3/race/${encodeURIComponent(params.id ?? '')}`} /> },

      { path: '*', Component: NotFoundPage, handle: { meta: { title: NOT_FOUND_TITLE } satisfies RouteMeta } },
    ],
  },
]

export const router = createBrowserRouter(routes)
