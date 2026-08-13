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

Run `pnpm cosmetics:generate` to regenerate original 256×256 SVG layers, attached previews, and `public/cosmetics/contact-sheet.html`. Run `pnpm cosmetics:validate` to reject duplicate IDs, invalid metadata, missing assets/previews, and malformed dimensions. `/dev/cosmetics` is the interactive visual-QA gallery.

The catalog lives in `lib/cosmetics/catalog.ts`; UI code must not define cosmetics locally. Layer order and duck anchors live in `lib/cosmetics/types.ts`.

## Shop and Mystery Egg

Shop rotations are generated once per Vietnam race week and stored in `ShopRotation`. Default prices are 2/4/7/12/20 QP. Player-facing offers exclude owned items.

Mystery Egg costs 3 QP. Published odds are 40/30/18/9/3%. Persistent guarantees activate after 5 misses for Rare+, 12 for Epic+, and 30 for Legendary. A duplicate rerolls once within its rarity; a remaining duplicate refunds 2 QP. Pull selection, ownership, pity, deduction, grant, refund, and audit all run server-side in one transaction.

## Operations

- `pnpm db:bootstrap`: schema sync plus idempotent data migration and starter grants.
- `pnpm gacha:simulate --pulls 1000000`: odds/pity simulation.
- `pnpm economy:simulate --weeks 12 --players 8`: season earning simulation.
- `/admin/cosmetics`: QP adjustment, grant/revoke, and audit inspection.

Back up the SQLite database before production migration. Rollback is application-first: deploy the prior build while leaving additive tables/columns in place. Do not delete ledger or inventory rows.
