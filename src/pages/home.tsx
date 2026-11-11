import { RedirectTo } from '@/src/redirect'

/** `/` has no page of its own: go to Season 3 and keep `?token=…` (magic links) and the hash. */
export default function HomePage() {
  return <RedirectTo to="/season-3" />
}
