# 🦆 AUTODUCK v2.0 — Competitive Balance Update

> **Mục tiêu**: Nâng cấp AutoDuck từ v1.0 (đua thuần + khiên/sẹo) lên v2.0 với 3 hệ thống cân bằng cạnh tranh: **Boss Duck**, **Shield Decay**, **Underdog Mystery Chest**.
>
> Tài liệu này dành cho **AI agents khác** (hoặc dev người) đọc và implement end-to-end. Mọi đường dẫn file đều **tuyệt đối hoá theo project root** `/Users/thanh.nguyen13/Desktop/be/autoduck`.

---

## 0. Snapshot codebase hiện tại (v1.0)

Stack:
- **Frontend**: Next.js 16 (App Router, React 19), Tailwind 4, shadcn/radix, theme "Goose Goose Duck Dark Vibrant".
- **Backend**: Next.js Route Handlers, Prisma 7 + `@prisma/adapter-better-sqlite3` (SQLite file `prisma/dev.db`).
- **Race engine**: Playwright (`lib/race-worker.ts`) tự động hoá `online-stopwatch.com/duck-race`. Có chế độ `SIMULATE_RACE=true` để chạy không browser.
- **Commentary**: Gemini (default) / Claude / Zai, queue async qua `lib/commentary-manager.ts` + `lib/event-bus.ts`.
- **Storage**: Cloudflare R2 (`lib/r2-upload.ts`) cho video + avatar.

Models hiện có (`prisma/schema.prisma`):

| Model | Field chính |
|---|---|
| `User` | `id, name(unique), avatarUrl?, scars, shields, shieldsUsed, totalKhaos, createdAt, updatedAt` |
| `Race` | `id, status(pending/running/finished/failed), videoUrl?, finalVerdict?, isTest, createdAt, finishedAt?` |
| `RaceParticipant` | `id, raceId, userId, usedShield, initialRank?, gotScar` |
| `CommentaryLog` | `id, raceId, timestamp, content` |
| `CommentaryJob` | `id, raceId, timestamp, screenshotB64, isRaceEnd, status, result, …` |

Logic phạt hiện có (`lib/shield-logic.ts`):
- Sort theo `initialRank` ngược → tìm 2 người không khiên → phạt (`gotScar=true`, `+1 scar`).
- Auto-convert: `2 scars → 1 shield` trong `calculateNewStats`.

Routes & UI:
- `app/page.tsx` — Dashboard + BXH + lịch sử.
- `app/race/new/content.tsx` — Setup trận: tick vịt + bật/tắt khiên.
- `app/race/[id]/page.tsx` + `race-live-view.tsx` — Live stream (CDP screencast qua SSE) + bảng kết quả + commentary feed.
- `app/admin/dashboard/content.tsx` — CRUD user (scars/shields/shieldsUsed/totalKhaos/avatar) + recalc.
- `app/api/races/start/route.ts` — Validate (Thứ 2 GMT+7, 1 trận/tuần), tạo race, gọi `runRaceWorker`, áp `calculatePenalties` + `calculateNewStats`.

---

## 1. Tổng quan 3 hệ thống mới (v2.0)

### 👑 1.1 Boss Duck System
- Vịt nào **3 tuần liên tiếp không bị Sẹo** ⇒ trở thành **Boss Duck**.
- Tuần kế tiếp Boss tham gia race ⇒ **spawn 3 con clone** (tổng 4 entrants mang cùng `userId`: 1 boss + 3 clone).
- **Bất kỳ clone nào về cuối/bét** (rơi vào danh sách 2 người bị phạt) ⇒ Boss bị **tính thua** (`gotScar=true`, +1 scar, phạt áp dụng cho user thật).
- Trạng thái Boss giữ qua các tuần cho tới khi Boss bị phạt 1 lần ⇒ reset `cleanStreak=0`.

### 🛡️ 1.2 Shield Decay System
- 2 Sẹo = 1 Khiên (giữ nguyên).
- **Khiên giữ 3 tuần không dùng → vỡ thành 1 Sẹo** (-1 shield, +1 scar).
- **Khiên giữ 5 tuần không dùng → mất hẳn** (-1 shield, không thêm sẹo).
- Khiên phải khai báo **trước race** (giữ nguyên flow hiện tại).
- Mỗi khiên track riêng tuổi (per-shield aging), không phải toàn bộ inventory.

### 🐣 1.3 Underdog Mystery Chest
- **Trigger**: ngay khi race finished (tức là 2 victims đã được xác định) ⇒ **server tự động roll chest** cho 2 user vừa bị phạt (`gotScar=true`) trong race **đó**.
- **Reveal**: kết quả roll hiển thị **trực tiếp trên race result board** (không cần user/admin click "Mở Rương"). Có animation reveal trong `RaceCelebration` + badge nằm cạnh tên 2 victims trong BXH kết quả.
- **Mandatory consumption**: chest đã có effect (≠ `NOTHING`) ⇒ **bắt buộc** phải dùng ở **race tiếp theo** mà chủ rương tham gia. Không có option "không dùng". Nếu sang tuần kế tiếp chủ rương **không tham gia** race ⇒ chest **hold qua** đến race kế tiếp họ tham gia (không expire by week tick).
- **Configuration trước race**: admin (người setup `/race/new`) sẽ thấy UI **bắt buộc** cấu hình target cho chest (nếu effect cần target). Không config xong ⇒ button "Chạy Đua" disabled.
- **Loot table**:

| % | Effect | Mã | Cơ chế |
|---|---|---|---|
| 50% | Không có gì | `NOTHING` | Roll xong, hết. Không carry sang race sau. |
| 10% | **Curse Swap** | `CURSE_SWAP` | Đổi `displayName` in-game với 1 vịt khác. Kết quả vẫn map về `userId` thật. |
| 10% | **Insurance Fraud** | `INSURANCE_FRAUD` | Nếu chủ rương về bét và bị phạt ⇒ kéo thêm 1 người (target chỉ định trước race) cùng chết → tổng victims = 3. |
| 10% | **Identity Theft** | `IDENTITY_THEFT` | Spawn 1 clone trong race; lấy `min(rank của bản gốc, rank của clone)` làm kết quả. Không cần target. |
| 10% | **Public Shield** | `PUBLIC_SHIELD` | Mượn 1 khiên của 1 vịt khác (target chỉ định, target phải có ≥1 khiên active). Khiên bị mượn trừ vào inventory người cho. |
| 10% | **I Choose You** | `I_CHOOSE_YOU` | Chỉ định 1 người. Nếu người đó về Top 1 ⇒ chủ rương được +1 khiên (skill phòng thủ thuần). |

---

## 2. Database schema changes

### 2.1 Sửa `User`

```prisma
model User {
  id          Int      @id @default(autoincrement())
  name        String   @unique
  avatarUrl   String?
  scars       Int      @default(0)
  shields     Int      @default(0)        // DEPRECATED count, dùng Shield model thay thế
  shieldsUsed Int      @default(0)
  totalKhaos  Int      @default(0)

  // ── v2.0 ──
  cleanStreak Int      @default(0)        // số tuần liên tiếp không bị scar
  isBoss      Boolean  @default(false)    // cờ Boss Duck cho tuần tiếp theo
  bossSince   DateTime?                   // Boss từ khi nào (UI badge)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  raceParticipations RaceParticipant[]
  ownedShields       Shield[]            @relation("ShieldOwner")
  loanedShieldsOut   Shield[]            @relation("ShieldLoanedTo")
  mysteryChests      MysteryChest[]
}
```

> **Ghi chú**: `User.shields` cũ vẫn giữ làm denormalized counter để UI cũ chạy được trong giai đoạn migrate, nhưng **source of truth** sẽ chuyển sang bảng `Shield` (per-shield aging).

### 2.2 Bảng mới `Shield` (per-shield tracking cho decay)

```prisma
model Shield {
  id          Int       @id @default(autoincrement())
  ownerId     Int
  earnedAt    DateTime  @default(now())   // tuần earn để tính tuổi
  earnedRaceId Int?                       // optional: race nào tạo ra khiên này
  weeksUnused  Int      @default(0)       // tăng 1 mỗi tuần Boss-tick chạy mà không dùng
  status      String    @default("active") // active | broken | lost | used | loaned
  consumedAt  DateTime?                   // khi dùng / vỡ / mất
  loanedToId  Int?                        // nếu Public Shield, đang cho ai mượn

  owner    User  @relation("ShieldOwner",    fields: [ownerId],    references: [id], onDelete: Cascade)
  loanedTo User? @relation("ShieldLoanedTo", fields: [loanedToId], references: [id])

  @@index([ownerId, status])
}
```

### 2.3 Sửa `RaceParticipant` — hỗ trợ clone

```prisma
model RaceParticipant {
  id          Int     @id @default(autoincrement())
  raceId      Int
  userId      Int
  usedShield  Boolean @default(false)
  initialRank Int?
  gotScar     Boolean @default(false)

  // ── v2.0 ──
  isClone     Boolean @default(false)     // true nếu là clone của Boss/Identity Theft
  cloneOfUserId Int?                      // userId thật của owner clone (cho join/aggregation)
  cloneIndex  Int?                        // 1..n để phân biệt clone cùng user
  displayName String?                     // tên override (Curse Swap)
  chestEffect String?                     // CURSE_SWAP | INSURANCE_FRAUD | IDENTITY_THEFT | PUBLIC_SHIELD | I_CHOOSE_YOU | NOTHING
  chestTargetUserId Int?                  // target chỉ định cho effect

  race Race @relation(fields: [raceId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([raceId, userId, cloneIndex])  // bỏ unique cũ, cho phép clone
}
```

### 2.4 Bảng mới `MysteryChest`

```prisma
model MysteryChest {
  id              Int       @id @default(autoincrement())
  ownerId         Int

  // Race vừa kết thúc trigger ra chest này (chủ rương là 1 trong 2 victims)
  earnedFromRaceId Int

  // Status flow:
  //   "active"   = đã roll, có effect, chờ race tiếp theo của owner để consume
  //   "consumed" = đã apply trong 1 race
  //   "void"     = effect = NOTHING (không cần consume), terminal state
  status          String    @default("active")

  // Set ngay khi chest được tạo (server roll RNG ở post-race resolve)
  effect          String                      // NOTHING | CURSE_SWAP | INSURANCE_FRAUD | IDENTITY_THEFT | PUBLIC_SHIELD | I_CHOOSE_YOU
  rngSeed         String                      // log để audit minh bạch

  // Chỉ set khi consumed
  consumedRaceId  Int?
  consumedAt      DateTime?

  // Snapshot config khi consume (target được chọn ở /race/new)
  targetUserId    Int?                        // user target cho effect (CURSE_SWAP/INSURANCE_FRAUD/PUBLIC_SHIELD/I_CHOOSE_YOU)

  createdAt       DateTime  @default(now())

  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId, status])
  @@index([earnedFromRaceId])
}
```

> **Thay đổi vs draft cũ**:
> - Bỏ `pending/opened/expired` — chest **luôn được auto-roll ngay khi tạo** (post-race resolve), nên không có trạng thái "chưa mở".
> - `NOTHING` ⇒ status `void` (terminal), không consume, không hiện ở race kế tiếp.
> - `effect ≠ NOTHING` ⇒ status `active` cho tới khi consume ở race tiếp theo owner tham gia (không expire by tick — hold đến khi dùng được).
> - `targetUserId` lưu ngay khi admin xác nhận setup race kế tiếp (không cần endpoint riêng để configure — gửi kèm payload `/api/races/start`).

### 2.5 Bảng mới `WeeklyTick` (lịch chạy decay/Boss check)

```prisma
model WeeklyTick {
  id          Int      @id @default(autoincrement())
  weekKey     String   @unique             // "2026-W17" theo ISO week
  runAt       DateTime @default(now())
  brokenShields Int    @default(0)
  lostShields   Int    @default(0)
  newBosses     Int    @default(0)
  chestsIssued  Int    @default(0)
  details     String?                       // JSON log, hữu ích cho admin tools tab
}
```

> **Migration command**: `pnpm db:push` (đang dùng), KHÔNG dùng migrations file vì project đang `db push` thuần.

### 2.6 Seed update

Bổ sung field mới vào `prisma/seed.ts`. Với existing data: backfill `cleanStreak=0`, `isBoss=false`, tạo 1 record `Shield(active)` cho mỗi `shields` count hiện tại để giữ nguyên inventory.

---

## 3. Logic backend

### 3.1 File mới `lib/boss-logic.ts`

```ts
export interface BossSpawnPlan {
  ownerUserId: number
  cloneCount: 3                 // luôn = 3 theo spec
}

// Sau mỗi race finished, gọi để cập nhật cleanStreak + flip isBoss
export function evaluateBossStatus(args: {
  userId: number
  gotScarThisRace: boolean
  currentCleanStreak: number
  currentIsBoss: boolean
}): { newCleanStreak: number, newIsBoss: boolean }

// Khi setup trận tiếp theo, dùng để inflate participants
export function expandBossParticipants(participants: RaceSetupPlayer[], users: User[]): RaceSetupPlayer[]
// → Với mỗi user.isBoss=true: spawn thêm 3 entries cùng userId, isClone=true, cloneIndex 1..3

// Chấm điểm: Boss thua nếu BẤT KỲ clone nào (hoặc bản gốc) nằm trong victims
export function resolveBossOutcome(args: {
  bossUserId: number
  raceVictims: { userId: number, isClone: boolean, cloneIndex?: number }[]
}): { bossLost: boolean }
```

**Quy tắc số học**:
- `cleanStreak` += 1 nếu `gotScar=false` ở race vừa rồi, reset về 0 nếu `gotScar=true`.
- `isBoss` = `cleanStreak >= 3` (lần đầu đạt mốc thì set `bossSince = now()`).
- Boss mất danh hiệu khi `gotScar=true` (cleanStreak reset).

### 3.2 File mới `lib/shield-decay.ts`

```ts
// Chạy mỗi tuần (hoặc trước mỗi race nếu chưa tick tuần này)
export async function tickShieldDecay(prisma): Promise<{
  broken: { shieldId: number, ownerId: number }[]
  lost:   { shieldId: number, ownerId: number }[]
}>
```

**Quy trình**:
1. Lấy mọi `Shield(status=active)` chưa dùng trong tuần hiện tại.
2. `weeksUnused += 1`.
3. Nếu `weeksUnused === 3` ⇒ `status = 'broken'`, `consumedAt = now()`, **owner.scars += 1**.
4. Nếu `weeksUnused >= 5` ⇒ `status = 'lost'`, `consumedAt = now()`, **không thêm scar**.
5. Khi user khai báo `usedShield=true` lúc race start ⇒ chọn shield **oldest active** của user, set `status='used'`, `consumedAt`.
6. Khi 2 scars convert thành 1 shield ⇒ tạo `Shield` mới với `weeksUnused=0`.

> **Lưu ý**: tick chạy idempotent theo `WeeklyTick.weekKey` để không double-decay.

### 3.3 File mới `lib/mystery-chest.ts`

```ts
const CHEST_TABLE = [
  { effect: 'NOTHING',          weight: 50 },
  { effect: 'CURSE_SWAP',       weight: 10 },
  { effect: 'INSURANCE_FRAUD',  weight: 10 },
  { effect: 'IDENTITY_THEFT',   weight: 10 },
  { effect: 'PUBLIC_SHIELD',    weight: 10 },
  { effect: 'I_CHOOSE_YOU',     weight: 10 },
] as const

export type ChestEffect =
  | 'NOTHING' | 'CURSE_SWAP' | 'INSURANCE_FRAUD'
  | 'IDENTITY_THEFT' | 'PUBLIC_SHIELD' | 'I_CHOOSE_YOU'

// Pure RNG, có seed cho audit/test
export function rollChest(seed?: string): { effect: ChestEffect, seed: string }

// Gọi NGAY khi race finished + victims đã xác định.
// Tự roll RNG cho 2 victims, tạo MysteryChest:
//   - effect=NOTHING ⇒ status='void'
//   - effect khác    ⇒ status='active'
// Trả về danh sách chest đã tạo để FE render reveal animation.
export async function issueChestsForVictims(
  prisma, raceId: number, victims: { userId: number }[]
): Promise<MysteryChest[]>

// Khi setup /race/new, lấy active chests của các participants để show UI config target
export async function getActiveChestsForUsers(
  prisma, userIds: number[]
): Promise<MysteryChest[]>

// Validate trước race start: mọi active chest phải có target hợp lệ (nếu effect cần target)
export function validateChestConfig(
  chests: MysteryChest[], participants: ParticipantInput[]
): { ok: boolean, errors: string[] }

// Mutate participant list theo effect trước khi gửi tới race-worker
export function applyChestPreRace(
  participants: ParticipantSetup[],
  activeChests: MysteryChest[]
): ParticipantSetup[]

// Áp dụng effect vào kết quả ranking sau race finished
export async function resolveChestPostRace(
  prisma, raceId: number,
  ranking: { userId: number, rank: number, isClone: boolean }[],
  victims: PenaltyVictim[],
  activeChests: MysteryChest[]
): Promise<{
  modifiedVictims: PenaltyVictim[],   // thêm INSURANCE_FRAUD targets
  shieldsToGrant:  { userId: number }[], // I_CHOOSE_YOU thắng → cấp shield
  newChestsForThisRace: MysteryChest[], // chest sinh ra cho 2 victims race này
}>
```

**Chi tiết từng effect khi resolve**:

- `NOTHING`: no-op. Chest tạo ra với `status='void'` ngay từ đầu.
- `CURSE_SWAP`: trước race, swap `displayName` giữa owner và `targetUserId`; kết quả vẫn map về `userId` thật → effect là **mind-game** thuần (commentary AI bias theo tên hiển thị, người xem live cũng bị lừa).
- `INSURANCE_FRAUD`: nếu owner `gotScar=true` ⇒ ép `targetUserId` cũng `gotScar=true` (push vào victims list, **bypass khiên** — kể cả target có khiên cũng dính). Nếu owner KHÔNG bị phạt ⇒ effect tịt, vẫn consume chest.
- `IDENTITY_THEFT`: spawn 1 entry clone (`isClone=true, cloneOfUserId=ownerId, cloneIndex=99` để phân biệt với boss clone). Khi resolve: `effectiveRank = min(originalRank, cloneRank)`, dùng rank đó để xét victims.
- `PUBLIC_SHIELD`: trước race, validate `targetUser` có ≥1 `Shield(active)`. Transfer 1 shield (oldest) từ target sang owner (`loanedToId=owner`, `status='loaned'`). Trong race, `owner.usedShield=true`. Post-race: shield đặt `status='used'` (vĩnh viễn rời khỏi inventory target).
- `I_CHOOSE_YOU`: post-race, nếu `target.initialRank===1` ⇒ tạo `Shield(weeksUnused=0)` cho owner. Nếu target không P1 ⇒ effect tịt, chest vẫn consume.

**Quy tắc consume**:
- Mọi `active` chest của participants thật sẽ được consume sau race (set `status='consumed'`, `consumedRaceId`, `consumedAt`).
- Nếu chest owner KHÔNG tham gia race ⇒ chest vẫn `active`, hold tiếp tới race kế.

### 3.4 Sửa `lib/shield-logic.ts`

`calculatePenalties` cần biết clone:
- Khi tìm 2 victims, **dedupe theo `userId` thật** trước khi đếm? **Không** — spec rõ: bất kỳ clone nào về bét tính là Boss thua. Nên giữ logic phân chia theo entry, nhưng khi **apply scar** thì map về `userId` thật và chỉ +1 scar/user kể cả nhiều clone cùng dính.

Thêm hook:
```ts
export function applyChestEffectsToVictims(
  victims: PenaltyVictim[],
  chestEffects: ChestEffect[]
): PenaltyVictim[]
```
→ áp `INSURANCE_FRAUD` đẩy thêm victim, dedupe.

### 3.5 Sửa `app/api/races/start/route.ts`

**Payload mới** (đính kèm chest config vào body, không cần endpoint riêng):

```ts
POST /api/races/start
{
  participants: [
    { userId, useShield, shieldId? },               // shieldId optional, server pick oldest nếu null
  ],
  chestConfigs: [                                    // bắt buộc cho mọi active chest của participants
    { chestId, targetUserId? },                      // targetUserId required nếu effect cần target
  ],
  test?: boolean,
  secret?: string,
}
```

**Thứ tự thực thi**:

1. **Pre-flight tick** (idempotent theo `WeeklyTick`):
   - Nếu chưa có `WeeklyTick` cho ISO-week hiện tại ⇒ chạy `tickShieldDecay` (chỉ shield decay, **chest đã được issue ở post-race trước đó** rồi nên không gọi `issueChests` ở đây).
2. **Validate**:
   - Thứ 2 GMT+7 + 1 trận/tuần (giữ nguyên).
   - Mọi active chest của participants phải có entry trong `chestConfigs`. Effect cần target ⇒ `targetUserId` valid (target nằm trong selected participants, không phải bản thân owner, target có shield nếu `PUBLIC_SHIELD`).
   - Reject với 400 nếu thiếu/sai config (FE phải block button).
3. **Build participant list mở rộng**:
   - `expandBossParticipants` (boss spawn 3 clone).
   - `applyChestPreRace` (curse-swap displayName, identity theft clone, public shield transfer).
4. **Run race** với `playerInputs` đã expand.
5. **Resolve post-race** (atomic transaction, thứ tự bắt buộc):
   1. `calculatePenalties` trên entries (clone-aware) → ra `victims` ban đầu.
   2. `resolveChestPostRace` áp effect **sequential, single-pass, không loop**:
      - `INSURANCE_FRAUD`: với mỗi chest, nếu owner ∈ victims ⇒ push target vào victims (bypass shield, dedupe userId, mỗi chest fire ≤1 lần).
      - `I_CHOOSE_YOU`: với mỗi chest, nếu target có `initialRank=1` ⇒ gom vào `shieldsToGrant`.
   3. `resolveBossOutcome` (boss thua nếu boss/clone của boss nằm trong victims **sau** bước 2).
   4. Map về `userId` thật → `calculateNewStats` (1 user += tối đa 1 scar/race, dedupe clone).
   5. `evaluateBossStatus` cho từng user → cập nhật `cleanStreak`, `isBoss`, `bossSince`.
      - **Invariant**: assert `!(user.isBoss && user has active chest)` — nếu vi phạm, throw + log error (xem §9 invariant).
   6. Cấp shield mới: `I_CHOOSE_YOU` thắng + auto-convert `2 scars → 1 shield`.
   7. Mark `Shield.status='used'` cho ai dùng khiên thường + chest `PUBLIC_SHIELD`.
   8. Mark mọi chest đã tham gia race này thành `consumed` (`consumedRaceId`, `consumedAt`, snapshot `targetUserId`).
   9. **`issueChestsForVictims`**: tạo `MysteryChest` cho 2 user vừa `gotScar=true` ở race này (auto-roll RNG, `effect=NOTHING ⇒ status=void`, ngược lại `status=active`).
6. **Emit `RACE_EVENTS.FINISHED`** với payload mở rộng:
   ```ts
   {
     raceId, winner, victims, verdict,
     bossOutcome: { bossUserId, bossLost } | null,
     chestsConsumed: [{ ownerName, effect, target, outcome: 'success'|'fizzled' }],
     chestsAwarded:  [{ ownerName, effect }],   // chest mới sinh ra từ race này
   }
   ```

### 3.6 Endpoint mới (đã giảm)

| Method | Path | Mục đích |
|---|---|---|
| POST | `/api/admin/tick` | Force chạy `tickShieldDecay` + log `WeeklyTick` (admin only, dev/test). |
| GET | `/api/admin/season` | Trả về `WeeklyTick` history + boss list + active shields aging + chest pipeline. |
| POST | `/api/admin/chests/[id]/reroll` | Admin re-roll RNG cho 1 chest (audit log seed cũ + mới). |
| POST | `/api/admin/chests/[id]/cancel` | Admin huỷ 1 active chest (set `status='void'`, kèm reason). |

> **Bỏ** `/api/chests/[id]/open` — chest tự roll ở post-race resolve.
> **Bỏ** `/api/chests/[id]/configure` — target gửi kèm `/api/races/start` payload.
> **Bỏ** `/api/shields/loan` — `PUBLIC_SHIELD` xử lý server-side trong race start (không cần workflow approval).

---

## 4. UI / UX changes

### 4.1 Dashboard `app/page.tsx` (BXH tổng)

Thêm vào BXH (mỗi row):

- **Badge 👑 BOSS** kế tên nếu `user.isBoss=true`, kèm tooltip "Race kế: spawn 3 clone".
- **Streak indicator**: "🔥 2/3 tuần sạch" nếu `cleanStreak >= 1`. Đầy 3/3 ⇒ effect glow vàng pulse.
- **Shield aging strip**: cột "KHIÊN" thay vì hiển thị số đơn, render **stack icon** với màu theo tuổi:
  - `0–1w`: xanh lá (an toàn)
  - `2w`: vàng (cảnh báo)
  - `3w trở lên`: đỏ pulse (sắp vỡ)
  - Tooltip hover liệt kê chi tiết: `🛡️#12 (1w), 🛡️#15 (4w ⚠️ 1 tuần nữa mất hẳn)`.
- **Chest ribbon**: nếu user có `MysteryChest(status='active')` ⇒ ribbon **🎁** ở góc avatar, badge nhỏ ghi tên effect (vd "🎁 PUBLIC SHIELD"). Tooltip nói rõ phải dùng race kế.

Thêm card mới bên phải (dưới Race History):

- **"👑 Boss Watch"**: list user có `cleanStreak >= 2`, hiển thị progress bar 2/3 hoặc 3/3 (Boss).
- **"⏳ Khiên Sắp Hỏng"**: list shield có `weeksUnused >= 2`, sort theo nguy cơ. Mỗi entry: avatar owner + `🛡️#15 còn 1 tuần → vỡ thành Sẹo`.
- **"🎁 Rương Đang Cầm"**: list mọi chest `status='active'`, kèm effect & yêu cầu (cần target hay không). Đây là warning cho admin biết race kế tiếp ai sẽ trigger gì.

Footer: bump `AUTODUCK v2.0 🦆 Quack Quack!`.

### 4.2 Race Setup `app/race/new/content.tsx` (cốt lõi UX của v2.0)

Layout mới có **3 sections** thay vì 1:

#### Section A — Player List (giống v1.0, có thêm badge)

Mỗi row bổ sung:
- **Boss banner**: nếu user `isBoss=true` ⇒ box màu vàng đứng độc lập ở đầu row "👑 BOSS DUCK — Race này spawn 3 clone, 1 clone bét = Boss thua".
- **Chest indicator**: nếu user có `MysteryChest(status='active')` ⇒ badge "🎁 PUBLIC_SHIELD" sticker, click để jump xuống Section B.
- **Shield chip selector**: thay toggle 1 nút bằng **stack of chips** đại diện cho từng `Shield(active)` của user. Click chip để bật khiên đó (oldest auto-suggest, có icon ⚠️ nếu sắp vỡ).
  - State: `unselected` (xám) ↔ `selected` (xanh + outline). Tối đa 1 chip per user (chỉ 1 khiên/race).

#### Section B — Mandatory Chest Configuration (mới, **bắt buộc**)

Box màu cam-tím nổi bật, hiển thị mọi active chest của participants đã chọn. Mỗi chest 1 card:

```
┌─────────────────────────────────────────────────┐
│ 🎁 Rương #42 — Zịt Tâm                          │
│ Effect: [🎯 I CHOOSE YOU]                       │
│                                                  │
│ Chỉ định 1 vịt: nếu vịt đó P1 ⇒ Zịt Tâm +1 Khiên │
│                                                  │
│ Chọn mục tiêu: [▼ Dropdown chọn vịt khác]      │
│ ⚠ Chưa chọn — bắt buộc để chạy đua             │
└─────────────────────────────────────────────────┘
```

Variants per effect:

| Effect | UI | Validation |
|---|---|---|
| `CURSE_SWAP` | Dropdown "Đổi tên với" + preview swap names | Target ≠ owner, target ∈ selected |
| `INSURANCE_FRAUD` | Dropdown "Kéo theo nếu chết" + warning "Bypass cả khiên!" | Target ≠ owner, target ∈ selected |
| `IDENTITY_THEFT` | Không cần target, chỉ show "Sẽ spawn 1 clone" + checkbox xác nhận | Auto-valid |
| `PUBLIC_SHIELD` | Dropdown "Mượn khiên của" — **chỉ list user có ≥1 khiên active** | Target có shield, target ∈ selected |
| `I_CHOOSE_YOU` | Dropdown "Đặt cược vào" + odds info | Target ≠ owner, target ∈ selected |

State machine cho button "Chạy Đua":
- Disabled nếu **bất kỳ** chest active chưa configure target hợp lệ.
- Tooltip lý do disabled: "Cần chọn mục tiêu cho rương của Zịt Tâm".

#### Section C — Pre-race Summary Panel (mới)

Show tổng entries thực tế sẽ vào race + drama warning:

```
🎬 Tổng quan race:
  • 7 vịt selected
  • +3 entries từ Boss Duck (Zịt Tuấn 👑)
  • +1 clone từ IDENTITY_THEFT (Zịt Minh)
  • 2 khiên đang bật, 1 khiên mượn (PUBLIC_SHIELD)
  ───────────────────────────────────
  → 11 entries thật trong race

⚠️ Drama đáng xem:
  • Boss Zịt Tuấn cần né 2 vị trí cuối với 4 entries
  • CURSE_SWAP: Zịt Tâm sẽ chạy dưới tên "Zịt Lợi"
  • INSURANCE_FRAUD: Zịt Lợi cài bom Zịt Dũng
```

### 4.3 Race Result Board (chest reveal directly here, **không có dialog mở rương**)

Update `app/race/[id]/page.tsx` + `components/race-celebration.tsx`:

#### Result board (sau finished)

BXH kết quả mở rộng cột:

| # | Vịt | Phòng Thủ | Effect | Kết Quả | 🎁 Rương Mới |
|---|---|---|---|---|---|

- Cột **"Effect"** (mới): nếu participant có chest consumed trong race này ⇒ badge "🎁 INSURANCE FRAUD → Zịt Dũng (✅ thành công)" hoặc "🎁 I CHOOSE YOU → Zịt Lợi (❌ tịt, target không P1)".
- Cột **"🎁 Rương Mới"** (mới): chỉ hiện cho 2 victims race này — animate reveal effect vừa roll:
  - 1.5s sau khi RaceCelebration play xong, slot này flip card từ rương đóng → rương mở → reveal effect với confetti.
  - `NOTHING` → "💨 TRỐNG TRƠN" màu xám.
  - effect ≠ NOTHING → màu vàng + emoji effect + "DÙNG TRONG RACE KẾ TIẾP".

#### RaceCelebration animation

Sequence:
1. Confetti + "👑 Vịt Thắng Cuộc" (giữ nguyên).
2. "🦆 2 Con Dzịt: ..." reveal (giữ nguyên).
3. **MỚI**: nếu Boss tham gia + Boss thua ⇒ overlay màu đỏ "👑💔 BOSS DUCK NGÃ NGỰA — Zịt Tuấn mất danh hiệu!".
4. **MỚI**: nếu có chest consumed ⇒ slide-in card mỗi effect "🎁 EFFECT REPORT: Zịt Lợi → INSURANCE_FRAUD ✅ Kéo theo Zịt Dũng".
5. **MỚI**: nếu có chest mới issued cho 2 victims ⇒ rương 3D wobble + reveal lần lượt 2 effect (slot machine animation).

#### Race Live `race-live-view.tsx` (trong khi đang chạy)

- **Clone visualization**: mỗi clone trong BXH live có badge "👤 Clone #2 of Zịt Tuấn" màu nhạt + opacity 0.7.
- **Boss banner**: header race có dải "👑 BOSS DUCK ARC — Zịt Tuấn (4 entries) cần né top 2 cuối".
- **Chest effect callout**: panel nhỏ bên phải fixed, list effect đang active:
  ```
  🎁 EFFECTS ACTIVE
  ─────────────────
  Zịt Tâm: 🎯 I CHOOSE YOU → Zịt Lợi
  Zịt Lợi: 💣 INSURANCE FRAUD → Zịt Dũng
  ```
- **Curse Swap notice**: nếu có swap, banner cảnh báo "⚠️ Zịt Tâm đang chạy dưới tên 'Zịt Lợi' — đừng tin mắt!".

### 4.4 Admin Dashboard `app/admin/dashboard/content.tsx`

Tab mới **"⚙️ Season"**:

- **Boss list**: user `isBoss=true`, `cleanStreak`, `bossSince`, button "Force Demote" (set `cleanStreak=0`, `isBoss=false`).
- **Shield aging table**: mọi `Shield(status='active')`, columns `id | owner | earnedAt | weeksUnused | status`, action buttons "Force Break / Force Lose / Reset Age".
- **Chest pipeline** (mới):
  - Tab phụ "🎁 Rương Đang Cầm": list `MysteryChest(status='active')`, columns `owner | effect | earnedFrom race # | createdAt`, action "Re-roll" (POST `/api/admin/chests/[id]/reroll`) + "Cancel/Void" (POST `/api/admin/chests/[id]/cancel`).
  - Tab phụ "📜 Chest History": list chest đã `consumed` hoặc `void`, kèm `consumedRaceId`, `targetUserId`, `rngSeed` (audit).
- **Weekly tick log**: bảng `WeeklyTick` gần nhất 12 tuần, expand JSON details.
- **Force tick button**: "🌀 Run Weekly Tick Now" (POST `/api/admin/tick`), dùng khi miss tick hoặc test (chỉ tick decay, không issue chest).

Tab **"VỊT"** (cũ): thêm cột editable `cleanStreak`, `isBoss`. Hiển thị thêm "🎁 Rương cầm" (read-only count) cho mỗi user.

### 4.5 Component mới

| Component | Mục đích | Dùng ở |
|---|---|---|
| `components/boss-badge.tsx` | Crown + glow + tooltip | Dashboard, Setup, Live, Result |
| `components/chest-card.tsx` | Card config target chest (Section B của Setup) | `/race/new` |
| `components/chest-reveal.tsx` | Animation flip rương + reveal effect | Result board + Celebration |
| `components/chest-icon.tsx` | Badge hiển thị effect compact (icon + name) | Mọi nơi |
| `components/shield-chip.tsx` | Chip selector 1 shield kèm tuổi | Setup, Dashboard tooltip |
| `components/shield-aging-stack.tsx` | Stack icon shields theo màu tuổi | Dashboard, Live |

---

## 5. Image / Asset requirements

Bỏ vào `public/assets/v2/`:

| Asset | Spec | Dùng ở |
|---|---|---|
| `boss-crown.svg` | crown vàng outline đen, 64×64 | Boss badge |
| `boss-aura.png` | radial glow vàng/cam transparent, 256×256 | Behind avatar khi `isBoss` |
| `clone-overlay.svg` | nhân bản 3 silhouette duck, 80×80 | Spawn animation |
| `chest-closed.png` | rương kho báu đóng, 256×256, retro pixel | Result board reveal step 1 |
| `chest-open.png` | rương mở phát sáng, 256×256 | Result board reveal step 2 |
| `chest-glow.gif` | aura xoay quanh rương | Result board ribbon, dashboard chest indicator |
| `chest-ribbon.svg` | dải ruy băng "🎁 ĐANG CẦM" | Dashboard avatar overlay |
| `effect-curse-swap.svg` | 2 mặt nạ swap | Reveal card |
| `effect-insurance-fraud.svg` | tay còng nắm 2 vịt | Reveal card |
| `effect-identity-theft.svg` | mặt nạ trắng + bóng | Reveal card |
| `effect-public-shield.svg` | khiên với mũi tên trao tay | Reveal card |
| `effect-i-choose-you.svg` | ngón tay chỉ + tia sét | Reveal card |
| `effect-nothing.svg` | mạng nhện rỗng | Reveal card (NOTHING) |
| `shield-cracked.svg` | khiên nứt cảnh báo | Tooltip "Khiên sắp vỡ" |
| `shield-broken.svg` | khiên vỡ vụn | Animation khi shield decay |
| `streak-flame.svg` | ngọn lửa cleanStreak | Dashboard |

Có thể tạm dùng emoji (👑🎁🛡️🔥) trong giai đoạn đầu, nhưng để giữ vibe Goose Goose Duck cần custom SVG sau.

---

## 6. AI commentary updates

`lib/ai-gemini.ts` (và Claude/Zai tương tự) — cần inject thêm context vào prompt:

```ts
{
  boss: { name: 'Zịt Tuấn', cloneCount: 3 },
  underdogs: [
    { name: 'Zịt Minh', chest: 'I_CHOOSE_YOU', target: 'Zịt Tâm' },
    { name: 'Zịt Lợi',  chest: 'INSURANCE_FRAUD', target: 'Zịt Dũng' },
  ],
  shieldsAtRisk: [{ owner: 'Zịt Thanh', weeksUnused: 4 }],
}
```

Prompt template mới (Vietnamese sarcastic MC):

> "Tuần này có Boss Duck **{boss.name}** mang 3 clone vào trận — chỉ cần 1 con clone về bét là Boss mất ngôi. Underdog **{underdog.name}** đã mở rương trúng **{chest}** chỉ vào **{target}** — drama đậm. Hãy bình luận như MC sòng bài Vegas pha chất phòng SEO Hà Nội."

`lib/commentary-manager.ts` `recordCommentary` thêm param `context?: RaceMetaContext` và lưu vào memory.

---

## 7. UX cho admin (chi tiết)

### 7.1 Pre-race UX (admin setup `/race/new` — quan trọng nhất)

Đây là trang admin dùng nhiều nhất mỗi tuần. Flow chuẩn:

1. Admin vào `/race/new` (qua link "Chạy Đua" ở dashboard).
2. Trang fetch danh sách users + active chests + boss states.
3. **Section A** (Player List): admin tick chọn vịt tham gia, bật khiên (chip selector per-shield).
4. **Section B** (Chest Config) tự động hiện ra nếu có participant nào có active chest. **Bắt buộc** config target cho mọi chest cần target (effect ≠ NOTHING/IDENTITY_THEFT).
5. **Section C** (Summary) live-updated theo selection. Admin verify số entries thật + drama warning trước khi bấm.
6. Button "Chạy Đua" disabled cho tới khi:
   - ≥ 2 vịt selected.
   - Mọi active chest đã có `targetUserId` hợp lệ (hoặc `IDENTITY_THEFT` đã confirm checkbox).
7. Bấm "Chạy Đua" ⇒ countdown 5s ⇒ POST `/api/races/start` với payload `{ participants, chestConfigs, ... }` ⇒ redirect `/race/[id]`.

**Edge case UX**:
- Nếu participant có chest active **không được chọn** vào race ⇒ chest tiếp tục hold. UI hiện toast warning "Zịt Tâm có rương 🎁 PUBLIC_SHIELD nhưng không tham gia race — sẽ giữ tới race kế".
- Nếu admin muốn skip 1 chest (force void) ⇒ phải vào `/admin/dashboard` Season tab ⇒ "Cancel" (không có shortcut ở `/race/new` để giữ flow đơn giản).

### 7.2 Post-race UX (admin xem result + chest mới)

1. Race finished ⇒ redirect tới `/race/[id]`.
2. RaceCelebration play 6s.
3. Result board hiện cột "🎁 Rương Mới" cho 2 victims race này, animate flip card reveal effect.
4. Admin nhìn thấy ngay 2 chest mới được issue + có thể click vào mỗi badge để xem detail (modal nhỏ với mô tả effect và "phải dùng race kế").
5. Dashboard `/` cập nhật ngay: 2 vịt vừa bị scar có ribbon 🎁 mới.

### 7.3 Admin season management (`/admin/dashboard` Season tab)

1. Mở `/admin/dashboard?secret=...` ⇒ tab **"⚙️ Season"**.
2. Sub-tab **Boss Watch**: list boss + cleanStreak progress, button Force Demote.
3. Sub-tab **Shield Aging**: bảng với filter theo tuổi, action Force Break / Force Lose / Reset Age.
4. Sub-tab **🎁 Chest Pipeline**: list chest active (chưa consume), button Re-roll (yêu cầu lý do, log seed cũ + mới) / Cancel (set `void`, log reason).
5. Sub-tab **📜 Chest History**: list consumed/void chest, đầy đủ audit (rngSeed, target, race id, effect).
6. Sub-tab **🌀 Weekly Tick**: list `WeeklyTick`, button "Run Now" — chỉ chạy `tickShieldDecay`, không issue chest (chest đã xử lý ở post-race).

### 7.4 Audit & transparency

- Mọi `tickShieldDecay`, `issueChestsForVictims`, force-update của admin lưu log JSON vào `WeeklyTick.details` (cho weekly action) hoặc inline trong `MysteryChest.rngSeed` (cho chest roll).
- Optional: bảng `AdminAuditLog` nếu cần timeline đầy đủ.

### 7.5 Rule of conduct (UX copy)

Update `app/page.tsx` "📖 Luật Chơi":

```
🤕 2 người cuối = con dzịt (+1 Sẹo)
🛡️ Dùng Khiên trước trận để thoát kiếp
✨ 2 Sẹo → 1 Khiên (auto)
⏳ Khiên 3 tuần không dùng → vỡ thành 1 Sẹo
💀 Khiên 5 tuần không dùng → mất hẳn
👑 3 tuần sạch → Boss Duck (race kế: 3 clone, clone bét = Boss thua)
🎁 Bị làm dzịt được mở rương ngay! Item rơi ra phải dùng race kế tiếp
```

---

## 8. Implementation roadmap (gợi ý chia phase)

### Phase 1 — DB & Migration (0.5 ngày)
- [ ] Sửa `prisma/schema.prisma` (User, RaceParticipant, +Shield, +MysteryChest, +WeeklyTick).
- [ ] `pnpm db:push` lên dev.db.
- [ ] Update `prisma/seed.ts` với backfill Shield records.
- [ ] Update `lib/types.ts` với types mới.

### Phase 2 — Pure logic + tests (1 ngày)
- [ ] Viết `lib/boss-logic.ts` + unit test.
- [ ] Viết `lib/shield-decay.ts` + unit test.
- [ ] Viết `lib/mystery-chest.ts` + unit test (RNG có seed).
- [ ] Sửa `lib/shield-logic.ts` clone-aware + test.

### Phase 3 — API integration (1 ngày)
- [ ] Sửa `app/api/races/start/route.ts` theo flow §3.5 (validate + consume chestConfigs + post-race issueChestsForVictims).
- [ ] Tạo `app/api/admin/tick/route.ts` (chỉ shield decay).
- [ ] Tạo `app/api/admin/season/route.ts` (read aggregate cho Season tab).
- [ ] Tạo `app/api/admin/chests/[id]/reroll/route.ts`.
- [ ] Tạo `app/api/admin/chests/[id]/cancel/route.ts`.
- [ ] Update `app/api/races/[id]/route.ts` trả thêm `chestsConsumed`, `chestsAwarded`, `cloneInfo`, `bossInfo`.
- [ ] Update `app/api/users/route.ts` (hoặc tạo `/api/race-setup-context`) trả thêm `activeChests`, `boss flag`, `shields detail` cho `/race/new`.

### Phase 4 — UI dashboard + setup (1.5 ngày)
- [ ] Update `app/page.tsx` (Boss badge, streak, shield aging stack, chest ribbon, Boss Watch / Khiên Sắp Vỡ / Rương Đang Cầm cards).
- [ ] Refactor `app/race/new/content.tsx` thành 3 sections (Players / Chest Config / Summary).
- [ ] Tạo `components/boss-badge.tsx` + `chest-card.tsx` + `chest-icon.tsx` + `shield-chip.tsx` + `shield-aging-stack.tsx`.

### Phase 5 — UI live + result (1 ngày)
- [ ] Update `app/race/[id]/page.tsx` (clone display, boss banner, chest effect column, chest reveal column).
- [ ] Update `app/race/[id]/race-live-view.tsx` (clone visual + chest callout panel + curse-swap banner).
- [ ] Tạo `components/chest-reveal.tsx` (flip + slot machine animation).
- [ ] Update `components/race-celebration.tsx` (Boss fall overlay + chest report + 2 victim chest reveal).

### Phase 6 — Admin tools + AI commentary (1 ngày)
- [ ] Update `app/admin/dashboard/content.tsx` thêm tab "Season" với 4 sub-tab (Boss / Shield / Chest Pipeline / Chest History / Weekly Tick) + extra fields tab "VỊT".
- [ ] Inject context (boss/clone/chest) vào `lib/ai-gemini.ts`, `ai-claude.ts`, `ai-zai.ts`.
- [ ] Update `lib/commentary-manager.ts` recordCommentary nhận `context?: RaceMetaContext`.

### Phase 7 — Assets + polish (0.5 ngày)
- [ ] Add SVG/PNG assets vào `public/assets/v2/`.
- [ ] Update copy luật chơi, footer version, README.
- [ ] Smoke test full flow: setup → race → reveal chest → setup race kế (mandatory consume) → reveal mới.

**Tổng ước lượng**: ~6 ngày work cho 1 dev (hoặc chia parallel 2-3 agent: BE/FE/Admin).

---

## 9. Edge cases & gotchas

> **Invariant quan trọng**: 1 user **không bao giờ** vừa là Boss vừa cầm chest active.
> - Boss = `cleanStreak >= 3` (3 race liên tiếp `gotScar=false`).
> - Chest chỉ issue cho user có `gotScar=true` ở race vừa rồi.
> - ⇒ Lần cuối user nhận chest, `cleanStreak` reset về 0. Để thành Boss phải sạch tiếp 3 race ⇒ trong 3 race đó không bị scar ⇒ không nhận chest mới ⇒ chest cũ chắc chắn đã `consumed` (mandatory ở race kế).
> Nên KHÔNG cần xử lý case "Boss vừa cầm chest" trong code, nhưng vẫn nên `assert` ở runtime để bắt bug logic.

### 9.1 Chest config edge cases

1. **PUBLIC_SHIELD không có ai đủ điều kiện cho mượn**: dropdown trống ⇒ admin không config được ⇒ button "Chạy Đua" disabled. Cách giải quyết: admin chọn thêm vịt khác có khiên vào race, **hoặc** vào `/admin/dashboard` Season tab → "Cancel chest" (set `void`, log lý do "không có target hợp lệ"). UI Section B hiện hint rõ: "⚠️ Không vịt nào trong danh sách có khiên active. Chọn thêm vịt có khiên hoặc cancel rương ở admin panel".
2. **CURSE_SWAP / I_CHOOSE_YOU / INSURANCE_FRAUD target ≠ owner & ∈ selected**: dropdown chỉ list `selected ∧ id ≠ ownerId`. Nếu chỉ có 1 vịt selected ngoài owner ⇒ auto-select.
3. **Insurance Fraud nhưng owner KHÔNG bị phạt**: effect tịt, chest vẫn `consumed`. Result board: "🎁 INSURANCE_FRAUD ❌ tịt — owner an toàn".
4. **Insurance Fraud target dùng khiên**: bypass khiên (target `gotScar=true` bất chấp), commentary giải thích "Khiên cũng không cứu nổi".
5. **I_CHOOSE_YOU target không P1**: effect tịt, chest vẫn consume. Show "🎁 I_CHOOSE_YOU ❌ tịt — target về #X".
6. **2 user cùng cầm chest cùng race**: bình thường (2 victims race trước cùng nhận chest). Section B render 2 card độc lập, validate riêng. Effect resolve theo thứ tự: `CURSE_SWAP` → `IDENTITY_THEFT` (pre-race) → race chạy → `INSURANCE_FRAUD` → `I_CHOOSE_YOU` (post-race).
7. **Cả 2 chest đều target nhau**: ví dụ A có `INSURANCE_FRAUD` chỉ B, B có `INSURANCE_FRAUD` chỉ A ⇒ nếu A bị phạt → kéo B vào → B cũng dính → trigger ngược: B bị phạt → kéo A. Implement: resolve sequential, dedupe userId, **không loop** (mỗi chest fire tối đa 1 lần).
8. **Chest target chính là Boss của race kế**: hợp lệ vì Boss vẫn là 1 vịt thường trong danh sách selected. Ví dụ `I_CHOOSE_YOU` nhắm Boss → nếu Boss P1 (sống sót cả 3 clone) ⇒ owner +1 khiên. Drama đậm vì Boss thường có rủi ro về bét.

### 9.2 Chest lifecycle

9. **Chest hold qua nhiều tuần**: nếu owner skip race ⇒ chest vẫn `active`, mang sang race kế tiếp họ tham gia. Đây là **tính năng**, không phải bug — chest comeback giữ giá trị tới khi user comeback. Admin có thể manual `cancel` ở Season tab nếu muốn xoá.
10. **Owner cầm chest mà bị admin loại khỏi user list**: dùng `onDelete: Cascade` trong `MysteryChest.owner` ⇒ chest tự xoá. Audit log lưu lại trước khi xoá nếu cần.
11. **Race fail giữa chừng**: nếu `runRaceWorker` throw (status=failed) ⇒ KHÔNG consume chest cũ, KHÔNG issue chest mới, KHÔNG decay shield, KHÔNG update boss streak. Restart race ⇒ chest config phải gửi lại từ FE.
12. **Chest reveal khi user reload result page**: animation chỉ trigger lần đầu (`sessionStorage` flag per `raceId`). Reload sau chỉ show static badge.

### 9.3 Curse Swap & race-worker

13. **Curse Swap tên trong commentary**: AI nói `displayName` (sai) chứ không phải `name` thật. Pass `displayName` vào prompt + `lib/race-worker.ts` fill `displayName` vào textarea `#namesList` của game iframe. Khi extract ranking từ `#resultsTable`, map `displayName → userId thật` để áp scar đúng người.
14. **Curse Swap conflict tên trùng**: nếu vô tình swap tạo ra 2 entry cùng name (vd cả 2 đều thành "Zịt Lợi") ⇒ append suffix tự động `Zịt Lợi (1)` và `Zịt Lợi (2)`, đồng thời log warning. UI hiển thị tên gốc + tên hiển thị qua `(was: ...)`.

### 9.4 Boss & shield interactions

15. **Boss thua nhờ INSURANCE_FRAUD của underdog**: hoàn toàn hợp lệ. Boss có 4 entries (1 boss + 3 clone), nếu underdog target boss và underdog bị phạt ⇒ boss `userId += 1 scar` (qua INSURANCE_FRAUD path) ⇒ `cleanStreak=0`, `isBoss=false`. Đây là drama đỉnh điểm, commentary phải highlight.
16. **Shield decay khi user đang giữ chest**: 2 hệ thống độc lập, decay không ảnh hưởng chest. Có thể đồng thời (vd race A: bị phạt → nhận chest + 2 khiên đang già). Race kế: dùng chest + có thể vẫn để khiên già tự decay.
17. **Migration data legacy**: user hiện tại có `shields=N` ⇒ tạo N record `Shield(weeksUnused=0)` để fair start (không decay ngay). KHÔNG tạo chest legacy cho ai — start clean từ race v2.0 đầu tiên (race đầu tiên sau migration sẽ là race "race 1" để issue chest).

### 9.5 Operational

18. **Tick duplicate**: `WeeklyTick.weekKey` unique chặn double tick. ISO week key format `YYYY-Www` Vietnam GMT+7.
19. **Test mode (`Race.isTest=true`)**: KHÔNG trigger Boss/Decay/Chest mutation — không `issueChestsForVictims`, không `evaluateBossStatus`, không consume shield/chest. Chỉ simulate ranking + commentary. Test race là sandbox thuần.
20. **Race start payload missing chestConfigs**: nếu FE gửi thiếu config cho 1 chest active ⇒ server reject 400 `{ error: "Thiếu config cho rương #42" }`. FE phải hiện toast + scroll tới Section B.

---

## 10. Acceptance criteria (Definition of Done)

- [ ] `pnpm db:push` chạy sạch, seed lại được (kèm backfill Shield records).
- [ ] Unit test `lib/boss-logic`, `lib/shield-decay`, `lib/mystery-chest` pass.
- [ ] Smoke test: chạy 4 race test (`SIMULATE_RACE=true`):
  - Race 1: thường, 2 victims được issue chest ngay sau race (reveal trên result board).
  - Race 2: 2 victims race 1 đem chest vào, admin **bắt buộc** config target ở `/race/new` Section B (button disabled cho tới khi config xong).
  - Race 3: 1 user đạt `cleanStreak=3` ⇒ `isBoss=true`.
  - Race 4: Boss vào race ⇒ 4 entries, clone bét ⇒ Boss bị +1 scar, `cleanStreak=0`.
- [ ] `issueChestsForVictims` được gọi với đúng 2 user vừa `gotScar=true` race vừa rồi (không phải top-2-cuối BXH tổng).
- [ ] `rollChest` 1000 lần, distribution ±2% so với 50/10/10/10/10/10.
- [ ] Khiên ngồi 3 tuần ⇒ broken (+1 scar). Khiên ngồi 5 tuần ⇒ lost (no scar). Decay đúng theo `Shield.earnedAt`.
- [ ] UI dashboard hiển thị badge Boss, ribbon 🎁 Đang Cầm, chip Shield aging với màu theo tuổi.
- [ ] `/race/new` Section B render đúng card per chest active, dropdown target chỉ list valid candidates, button disabled khi chưa config xong.
- [ ] Result board hiển thị cột "Effect" (chest đã consume race này) + cột "🎁 Rương Mới" (chest issued cho 2 victims race này) với reveal animation.
- [ ] RaceCelebration play đúng sequence: winner → 2 dzịt → boss fall (nếu có) → chest report → 2 chest reveal mới.
- [ ] Admin Season tab có 5 sub-tab hoạt động: Boss / Shield / Chest Pipeline / Chest History / Weekly Tick.
- [ ] Admin có thể force tick decay + reroll/cancel chest + override field user.
- [ ] Commentary AI nhắc đến Boss/Chest/CurseSwap trong race output (verify bằng prompt log).
- [ ] Reload result page giữa animation ⇒ animation không replay (sessionStorage flag).
- [ ] Footer version bump `v2.0`.

---

## 11. File/path checklist (cho agent implement)

**Tạo mới**:
- `lib/boss-logic.ts`
- `lib/shield-decay.ts`
- `lib/mystery-chest.ts`
- `app/api/admin/tick/route.ts`
- `app/api/admin/season/route.ts`
- `app/api/admin/chests/[id]/reroll/route.ts`
- `app/api/admin/chests/[id]/cancel/route.ts`
- `components/boss-badge.tsx`
- `components/chest-card.tsx` — card config target trong Section B của `/race/new`
- `components/chest-reveal.tsx` — animation flip + slot machine
- `components/chest-icon.tsx` — badge icon + name compact
- `components/shield-chip.tsx` — chip per-shield selector
- `components/shield-aging-stack.tsx` — stack icon theo tuổi
- `public/assets/v2/*` — SVG/PNG list §5

**Sửa**:
- `prisma/schema.prisma` (User, RaceParticipant, +Shield, +MysteryChest, +WeeklyTick)
- `prisma/seed.ts` (backfill Shield records cho legacy users)
- `lib/types.ts` (thêm `ChestEffect`, `MysteryChest`, `Shield`, `BossInfo`, `RaceMetaContext`)
- `lib/shield-logic.ts` (clone-aware + `applyChestEffectsToVictims`)
- `lib/commentary-manager.ts` (param `context?: RaceMetaContext`)
- `lib/ai-gemini.ts`, `lib/ai-claude.ts`, `lib/ai-zai.ts` (inject boss/chest context vào prompt)
- `lib/race-worker.ts` (dùng `displayName` thay vì `name` khi fill iframe textarea)
- `app/api/races/start/route.ts` (validate chestConfigs, call expand/applyChestPreRace, post-race resolveChestPostRace + issueChestsForVictims)
- `app/api/races/[id]/route.ts` (return `chestsConsumed`, `chestsAwarded`, `bossInfo`, `cloneInfo`)
- `app/api/users/route.ts` (hoặc tạo route mới `/api/race-setup-context` trả gộp users + activeChests + shields detail)
- `app/api/admin/route.ts` (cho phép update `cleanStreak`, `isBoss`)
- `app/page.tsx` (badges Boss/streak/chest ribbon + cards Boss Watch / Khiên Sắp Hỏng / Rương Đang Cầm + luật mới)
- `app/race/new/content.tsx` (refactor 3-section layout: Players + mandatory Chest Config + Summary)
- `app/race/[id]/page.tsx` (cột Effect + cột 🎁 Rương Mới + boss banner)
- `app/race/[id]/race-live-view.tsx` (clone visual + chest callout panel + curse-swap warning banner)
- `app/admin/dashboard/content.tsx` (tab Season với 5 sub-tab + extra cột tab VỊT)
- `components/race-celebration.tsx` (boss fall overlay + chest report + 2 victim chest reveal)

---

🦆 **Quack Quack v2.0** — đua không chỉ về tốc độ mà còn về drama, chính trị, và rủi ro.
