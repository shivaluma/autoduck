import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import './fonts.css'
import './globals.css'
import { router } from './router'

// After a deploy, an open tab still runs the old build, whose lazy route chunks are gone. Reload to pick up
// the new index.html (served no-cache) instead of showing the error page. At most one reload per 30 s, so a
// chunk that is missing for another reason shows the error page instead of reloading forever.
const RELOAD_KEY = 'autoduck-chunk-reload-at'
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 30_000) return
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

// index.html carries a static title and description for link unfurlers that don't run JS. Each route renders
// its own (React 19 hoists them into <head>), so drop the static ones to keep a single <title>.
for (const element of document.head.querySelectorAll('[data-static-meta]')) element.remove()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
