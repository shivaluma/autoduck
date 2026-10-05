# Đua Dzịt S3 cosmetic economy

Cosmetics are visual only. They are snapshotted into `Race.engineConfigJson`; no cosmetic ID is read by race physics, ranking, Chaos, Shield, or championship logic.

## Quack Points

- Official displayed winner: +5 QP.
- Correct prediction of the final Chaos losing group: +2 QP when there are exactly two losers, otherwise +1 QP.
- Winner plus correct prediction: +1 QP Perfect Week bonus.
- Test races and participation grant nothing.
- Every mutation creates an idempotent `CurrencyTransaction` in the same database transaction as the balance update.

Legacy Prediction Points and physical merch remain separate so the existing Season 3 reward flow is not broken.

## Content pipeline

Duck Closet v2 (see `docs/cosmetics-v2-redesign.md`) has 122 hand-designed items across the 8 closet tabs. Rarity is set by hand to match each item's art budget.

- Catalog metadata: `lib/cosmetics/catalog.ts`. UI code must not define cosmetics locally.
- Art: one draw function per catalog ID in `scripts/cosmetics/art/<slot>.ts`, built from the shared helpers in `scripts/cosmetics/kit.ts`. Skins and outfits mask to `DUCK_PATHS` from `lib/cosmetics/avatar-rig.ts` so they hug the body.
- Frame: every v2 layer uses `AVATAR_VIEWBOX` (`-24 -56 560 560`, the 512 rig padded for headroom), so stacked `<img>` layers stay aligned. Per-slot preview and closet-tile crops live in `SLOT_FRAMES` (`lib/cosmetics/types.ts`), next to the layer order.
- `pnpm cosmetics:generate` writes `public/cosmetics/v2/<slot>/<id>.svg` plus framed previews.
- `pnpm cosmetics:validate` fails on:
  - missing art, assets or previews
  - a tab missing any rarity, or an item in a slot with no closet tab
  - duplicate element IDs inside an SVG
  - recolor duplicates (two items in a slot that differ only by color)
  - a shop pool below the rotation minimums
- `pnpm exec tsx scripts/render-contact-sheet.ts` renders `public/cosmetics/contact-sheet.{html,png}`. `/dev/cosmetics` is the interactive gallery.
- Retired v1 IDs are frozen in `lib/cosmetics/legacy-v1.ts`. App migration `2026-10-05-001-cosmetics-v2-catalog` swaps each retired item for its `LEGACY_REMAP` equivalent or refunds its v1 shop price.

## Shop and Mystery Egg

Shop rotations are generated once per Vietnam race week and stored in `ShopRotation`. Default prices are 2/4/7/12/20 QP. Player-facing offers exclude owned items.

Mystery Egg costs 3 QP. Published odds are 40/30/18/9/3%. Persistent guarantees activate after 5 misses for Rare+, 12 for Epic+, and 30 for Legendary. A duplicate rerolls once within its rarity; a remaining duplicate refunds 2 QP. Pull selection, ownership, pity, deduction, grant, refund, and audit all run server-side in one transaction.

## Operations

- `pnpm db:bootstrap`: schema sync plus idempotent data migration and starter grants.
- `pnpm gacha:simulate --pulls 1000000`: odds/pity simulation.
- `pnpm economy:simulate --weeks 12 --players 8`: season earning simulation.
- `/admin/cosmetics`: QP adjustment, grant/revoke, and audit inspection.

Back up the SQLite database before production migration. Rollback is application-first: deploy the prior build while leaving additive tables/columns in place. Do not delete ledger or inventory rows.
