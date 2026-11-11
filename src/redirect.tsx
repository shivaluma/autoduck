import { Navigate, useLocation, useParams, type Params } from 'react-router'

/**
 * Client-side redirect that keeps the query string and the hash. `/?token=…` must land on `/season-3?token=…`
 * (magic links), and old links keep their `#section`.
 */
export function RedirectTo({ to }: { to: string | ((params: Params) => string) }) {
  const { search, hash } = useLocation()
  const params = useParams()
  const pathname = typeof to === 'function' ? to(params) : to
  return <Navigate replace to={{ pathname, search, hash }} />
}
