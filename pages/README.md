# Placeholder for Next.js (Vite transition, plan Phase 4)

Pages are the Vite SPA in `src/pages`; Next serves only the API route handlers in `app/api`.

Next looks for a Pages Router directory at `pages/` and then at `src/pages/`, and refuses to start when
`pages` and `app` have different parents (`pages and app directories should be under the same folder`).
This empty `pages/` directory makes Next stop at the root, so it never treats `src/pages/*` as Next pages.
Do not add `.tsx`/`.ts` files here. Delete the directory together with Next (Phase 8).
