# race-protocol: TS → Rust mapping

How `packages/race-protocol/src/index.ts` (the Zod schemas) and the event
metadata written by the TS engine map onto `crates/race-protocol`. The TS code
is the oracle and was not modified. Line numbers refer to the `rewrite`
branch at the Phase 1 branch cut.

Verified by `crates/race-protocol/tests/` (see "Verification" at the end):
every event the TS engine emitted over 400 races (178,921 events, 63 types)
deserialises into `EventKind` and re-serialises with the same top-level keys,
the same metadata keys and bit-identical values.

## Module layout

| Module | Contents |
|---|---|
| `ids` | `PlayerId`, `RaceId`, `ClientActionId`, `RaceSeed` (validated newtypes, D6); `RaceItemId`, `WildItemId`, `ItemKey`, `PickupSpawnType`, `HazardType`; the `wire_enum!` macro |
| `config` | `RaceConfigInput` (as received) → `resolve()` → `ResolvedRaceConfig` (D8); `ConfigError` |
| `events` | `RaceEvent` (wire shape + `seq`), `EventKind` (69 variants), 45 metadata structs and their value enums; `WildItemUseCommand`, `RecordedWildItemInput` |
| `snapshot` | `StateSnapshotMessage`, `RaceWorld` (what `applyWorld` takes), duck/pickup/hazard/rocket/banana snapshots, `RaceLifecycleState`, `ActiveEffect` |
| `result` | `RaceFinishEntry`, `RaceResult`, `DigestEnvelope`, `DigestStanding` (D9) |
| `replay_track` | DTRK/1 preamble, `DtrkHeader`, section framing (D10, plan 4.2) |
| `legacy` | `LegacyRaceConfigV1` (lenient, display-only) and `LegacyJson` |
| `versions` | D2 constants (skeleton) |

All wire structs use `#[serde(rename_all = "camelCase")]`, so the JSON keys are
the TS keys. `Option::None` keys are omitted unless TS writes `null` for them.

## Zod schema → Rust type

| TS (`packages/race-protocol/src/index.ts`) | Rust | Notes |
|---|---|---|
| `playerIdSchema` (:12) | `ids::PlayerId` | D6 narrows `string 1..128` to `^[0-9A-Za-z_:-]{1,64}$`. Ordered by bytes. |
| — | `ids::RaceId` | TS `raceId: z.string().min(1)`; Rust uses the D6 alphabet, 1..64. Official ids are decimal, the lab uses `race-lab-N`. |
| `raceSeedSchema` (:13) | `ids::RaceSeed` | 64 hex, either case, kept verbatim (the RNG hashes the text). |
| `raceItemIdSchema` (:14-24) | `ids::RaceItemId` | 9 literals. |
| `wildItemIdSchema` (:27-36) | `ids::WildItemId` | 8 literals. |
| `RaceItemId \| WildItemId` | `ids::ItemKey` | 14 literals; used by `AI_INTENT.itemId`. |
| `wildItemUseCommandSchema` (:39-45) | `events::WildItemUseCommand` | `clientActionId` is a `ClientActionId` (D6: id alphabet, 8..64; TS allowed 8..160 of anything). `wildItemInstanceId` stays a `String` with the TS 1..160 bound (`has_valid_instance_id`). |
| `RecordedWildItemInput` (:48-50) | `events::RecordedWildItemInput` | + `authoritativeTick: u32`. |
| `pickupSpawnTypeSchema` (:52) | `ids::PickupSpawnType` | |
| `hazardTypeSchema` (:55) | `ids::HazardType` | |
| `raceLoadoutSchema` (:58-62) | `config::RaceLoadout` | `source` is `config::LoadoutSource`. Max 2 items checked in `resolve()`. |
| `raceChaosConfigSchema` (:65-69) | `config::RaceChaosConfigInput` → `config::RaceChaosConfig` | Input: `targetPlayerId` absent or `null` = none; `groups` optional. Resolved: `targetPlayerId` always present (`null` when none), `groups` always present. `type` is `config::ChaosType`. |
| `raceItemTuningSchema` (:72-77) | `config::RaceItemTuningInput` → `config::RaceItemTuning` | Resolved values are concrete (see defaults). |
| `pickupConfigSchema` (:80-95) | `config::PickupConfigInput` → `config::PickupConfig` | Input fields all optional; `regularPickupCap` is read as a JSON number and must be integral 1..3 (Zod `int()`). |
| `racePlayerConfigSchema` (:98-103) | `config::RacePlayerConfigInput` → `config::RacePlayerConfig` | `name` 1..80 and `cosmeticKey` ≤2048 are measured in UTF-16 code units, like Zod. Resolved `isGhost` is always present. |
| `raceConfigSchema` (:105-121) | `config::RaceConfigInput` → `config::ResolvedRaceConfig` | Unknown keys ignored (Zod strips them). `tickRate` must be 60 when present. `engineVersion` major < 2 is refused with `ConfigError::LegacyEngineVersion`; such configs parse as `legacy::LegacyRaceConfigV1`. Rust adds a duplicate-`playerId` check. |
| `raceLifecycleStateSchema` (:126-136) | `snapshot::RaceLifecycleState` | |
| `duckSnapshotSchema` (:140-153) | `snapshot::DuckSnapshot` | `activeEffects` is `Vec<ActiveEffect>` (TS `string[]`, closed set from `items/engine.ts:889-904`). `wildItem` defaults to `null`, `regularPickupCount` to 0 (Zod defaults). |
| `stateSnapshotMessageSchema` (:156-190) | `snapshot::StateSnapshotMessage` = header + flattened `snapshot::RaceWorld` | `pickups/hazards/rockets/bananas` default to `[]`. `RaceWorld` is the `Pick<…>` that `applyWorld` takes (`components/racing/phaser-race-canvas.tsx:806`). Rocket/banana `id` is `u32`. |
| `raceEventTypeSchema` (:193-213) | `events::EventKind::TYPE_NAMES` | Same 69 literals in the same order (tested). |
| `RaceEvent` / `raceEventSchema` (:216-234) | `events::RaceEvent` | `{raceId, tick, timestampWithinRaceMs, sourcePlayerId?, targetPlayerId?, type, metadata, seq}`. `type`+`metadata` come from the flattened, adjacently tagged `EventKind`. `seq` (D7) is new and required. |
| `RaceFinishEntry` (:236-241) | `result::RaceFinishEntry` | |
| `RaceResult` (:243-252) | `result::RaceResult` | `tickRate: u32`. |
| `ServerRaceMessage` (:254-258) | — | Not ported: nothing consumes it; D16 SSE v2 frames replace it (Phase 5). |
| — | `result::DigestEnvelope`, `result::DigestStanding` | D9. |
| — | `replay_track::DtrkHeader` and friends | Plan 4.2. |
| stored TS configs (engine ≤ 1.2.0) | `legacy::LegacyRaceConfigV1` | D8. |

## Config defaults (all in `RaceConfigInput::resolve`)

| Field | Default | TS origin |
|---|---|---|
| `protocolVersion` | `versions::RACE_PROTOCOL_VERSION` (`2.0.0`) | Zod default `1.0.0` (:108) |
| `engineVersion` | `RACE_ENGINE_VERSION` (`2.0.0`) | Zod `1.2.0` (:109) |
| `balanceVersion` | `RACE_BALANCE_VERSION` (`S3.16`) | Zod `S3.15` (:110) |
| `trackVersion` | `TRACK_VERSION` (`river-01-v2`) | (:111) |
| `pickupSpawnVersion` | `PICKUP_SPAWN_VERSION` (`pickups-v2`) | optional in TS (:112) |
| `hazardBalanceVersion` | `HAZARD_BALANCE_VERSION` (`hazards-v2`) | optional in TS (:114) |
| `wildItemBalanceVersion` | none (passed through) | optional in TS (:113); D2 names no value |
| `tickRate` | 60 | (:115) |
| `loadouts` | `[]` | (:117) |
| `chaosConfig` absent | `{type: NORMAL, targetPlayerId: null, groups: []}` | `auto-use/objective.ts:21-23`, `chaos-utility.ts:37-40`, `items/engine.ts:122` |
| `itemTuning.nitroSpeedMultiplier` | 1.25 | `items/engine.ts:177` → `items/config.ts:13` |
| `itemTuning.rocketSlowMultiplier` | 0.15 | `items/engine.ts:178` → `items/config.ts:46` |
| `itemTuning.bananaKnockbackMultiplier` | 1 | `items/engine.ts:179` |
| `itemTuning.bananaSlowMultiplier` | 1 | `items/engine.ts:180` |
| `pickupConfig` **absent** | `PickupConfig::disabled()`: everything off, `goldenBoxProbability 0`, `spawnMultiplier 0`, `positionAwareLoot true`, `regularPickupCap 3` | `pickups/engine.ts:87-104` |
| `pickupConfig` present: `enabled`, `goldenBoxEnabled`, `hazardsEnabled`, `positionAwareLoot`, `manualItemsEnabled`, `autoItemsEnabled` | `true` | Zod (:81-90) and `pickups/engine.ts:106-114` |
| `goldenBoxProbability` | **0.15** (D8) | was Zod 0.12 (:83) vs engine 0.18 (`pickups/config.ts:5`) |
| `spawnMultiplier` | 1 | (:86) |
| `regularPickupCap` | 3 | (:87), `pickups/config.ts:4` |
| `chaosBoxEnabled`, `forceGoldenBox` | `false` | (:90, :94) |
| `forceItem` | none | (:91) |
| `disabledItems`, `idealManualPlayerIds` | `[]` | (:92-93) |
| player `isGhost` | `false` | `ghost.ts:3-9` treats absent as false |

Ranges checked (Zod, inclusive): `nitroSpeedMultiplier` 1..1.35,
`rocketSlowMultiplier` 0.1..1, `bananaKnockbackMultiplier` 0.5..2,
`bananaSlowMultiplier` 0.75..1, `goldenBoxProbability` 0..1,
`spawnMultiplier` 0..3, `regularPickupCap` integer 1..3, players 2..16,
loadout items ≤ 2.

## Events

`EventKind` is adjacently tagged (`type` + `metadata`) and flattened into
`RaceEvent`. Every metadata struct has `deny_unknown_fields`, so a TS key the
Rust side does not model fails deserialisation instead of being dropped.

Legend: **S/T** = `sourcePlayerId` / `targetPlayerId` presence (S = always,
s = sometimes, — = never). Required keys are always written; `?` keys only on
some paths; `null` marks keys TS writes as `null` (kept on the wire).
`autoReason?` on wild-item paths comes from the wrapper at
`auto-use/execute.ts:256`, which appends `autoReason` to every event emitted
while an auto-used wild item activates. All TS paths are relative to
`packages/race-core/src/` unless noted.

| Type | Rust metadata | S/T | Keys | TS emit sites |
|---|---|---|---|---|
| `RACE_STARTED` | `RaceStartedMeta` | —/— | `playerCount` | `simulation.ts:213` |
| `DUCK_COLLISION` | `EmptyMeta` | S/T | — | `simulation.ts:478-483` |
| `ITEM_ACTIVATED` | `EmptyMeta` | — | never emitted | — |
| `ROCKET_FIRED` | `RocketFiredMeta` | S/T | `autoReason`, `decisionTargetId` (null), `executeTargetId` (null), `retargetedAtExecute` | `items/engine.ts:559` + `auto-use/arbiter.ts:117-122` |
| `ROCKET_HIT` | `RocketHitMeta` | S/T | `shockAbsorbed` | `items/engine.ts:662` |
| `ROCKET_BLOCKED` | `ProjectileBlockedMeta` | S/T | `defense`, `blocked?` (never on rockets) | `items/engine.ts:669,673,676` |
| `ROCKET_EXPIRED` | `EmptyMeta` | S/T | — | `items/engine.ts:581` |
| `BANANA_DROPPED` | `BananaDroppedMeta` | S/— | `progress`, `lateralOffset`, `aimOffset`, `autoReason` | `auto-use/execute.ts:132` |
| `BANANA_HIT` | `BananaHitMeta` | S/T | `lateralSlip`, `shockAbsorbed` | `items/engine.ts:753` |
| `BANANA_BLOCKED` | `ProjectileBlockedMeta` | S/T | `defense`, `blocked?` | `items/engine.ts:759,763,772,774` (772/774 also for wild bananas, without `blocked`) |
| `BANANA_EXPIRED` | `BananaExpiredMeta` | S/— | `id` | `items/engine.ts:686` |
| `NITRO_STARTED`, `DRAFT_FIN_STARTED`, `PADDLE_BURST_STARTED` | `SpeedBoostStartedMeta` | S/— | `untilTick`, `durationSeconds`, `multiplier`, `queued?`, `draftTarget?` (null; Draft Fin only), `autoReason?`, `startRank?`, `startProgress?` (Nitro only), `drained?` | `items/engine.ts:435` (+ `auto-use/execute.ts:38-41,49-52,63`; `drained` at `items/engine.ts:406`), queued start `items/engine.ts:476-481` |
| `NITRO_ENDED`, `DRAFT_FIN_ENDED`, `PADDLE_BURST_ENDED` | `SpeedBoostEndedMeta` | S/s | broken: `broken`, `consumedSeconds`, `autoReason?`; natural: `consumedSeconds`, `natural`, `startProgress?`, `startRank?` (the duck's last Nitro start, so it also appears on Draft Fin / Paddle ends) | broken `items/engine.ts:268,289`; natural `:445-450` |
| `PREDATOR_RUSH_STARTED` | `PredatorRushStartedMeta` | S/— | `trigger`, `multiplier`, `durationSeconds`, `untilTick` | `items/engine.ts:382-387` |
| `PREDATOR_RUSH_ENDED` | `EmptyMeta` | — | never emitted | — |
| `BOOST_BROKEN` | `BoostBrokenMeta` | S (victim)/T (attacker) | `endedItem` (null), `remainingBoostTicks`, `originalBoostTicks`, `boostMultiplier`, `fractionDenied`, `breakSource`, `partial`, `autoReason?` | `items/engine.ts:270-278,290-298` |
| `SPEED_BOOST_QUEUED` | `SpeedBoostQueuedMeta` | S/— | `itemId`, `durationSeconds`, `multiplier`, `replacedPrevious`, `replacedItemId?` | `items/engine.ts:414,420` |
| `SHOCK_ABSORBER_PROC` | `ShockAbsorberProcMeta` | S/T | `mitigated` | `items/engine.ts:610,710`; `auto-use/execute.ts:177` |
| `HORN_USED` | `HornUsedMeta` | S/— | `targets`, `autoReason`, `slipstreamChargeDestroyedTicks`, `slipstreamChargeDestroyedSeconds`, `ducksHit`, `side` (−1/1), `silencedSeconds` | `auto-use/execute.ts:206-214` |
| `ITEM_SILENCED` | `ItemSilencedMeta` | S/T | `durationSeconds`, `untilTick`, `source`, `autoReason?` | `auto-use/execute.ts:191-195`; `pickups/engine.ts:461` |
| `FEATHER_DODGED` | `FeatherDodgedMeta` | S/T | `blocked?` (horn path only) | `items/engine.ts:770`; `auto-use/execute.ts:161` |
| `BUBBLE_SHIELD_ACTIVATED` | `BubbleShieldActivatedMeta` | S/— | `durationSeconds`, `untilTick`, `autoReason`, `reflex?` | `items/engine.ts:356-360` (reflex `:368`) |
| `BUBBLE_SHIELD_EXPIRED` | `EmptyMeta` | S/— | — | `items/engine.ts:843` |
| `BUBBLE_POPPED` | `BubblePoppedMeta` | S/T | `blocked`, `intact?` | `items/engine.ts:672,762`; `auto-use/execute.ts:155` |
| `DUCK_FINISHED` | `DuckFinishedMeta` | S/— | `finishTimeMs` | `simulation.ts:604-608` |
| `RACE_FINISHED` | `EmptyMeta` | —/— | — | `simulation.ts:633` |
| `CHAOS_RESOLVED` (meta) | `ChaosResolvedMeta` | —/— | `chaosType`, `loserPlayerIds` | `lib/season3-race.ts:314-324` |
| `PICKUP_ZONE_ACTIVATED` | `PickupZoneActivatedMeta` | —/— | `zoneId` | `pickups/engine.ts:347` |
| `PICKUP_SPAWNED` | `PickupSpawnedMeta` | —/— | `pickupId`, `zoneId`, `pickupType`, `progress`, `lateralOffset` | `pickups/engine.ts:211-213` |
| `PICKUP_COLLECTED` | `PickupCollectedMeta` | S/— | `pickupId`, `pickupType`, `progress`, `lateralOffset` | `pickups/engine.ts:330` |
| `PICKUP_SKIPPED_SLOT_FULL` | `PickupSkippedSlotFullMeta` | S/— | `pickupId`, `itemId` | `pickups/engine.ts:315` |
| `WILD_ITEM_GRANTED` | `WildItemGrantedMeta` | S/— | `pickupId`, `instanceId`, `itemId`, `rank` | `pickups/engine.ts:273` |
| `WILD_ITEM_USED` | `WildItemUsedMeta` | S/s | `instanceId`, `itemId` | `pickups/engine.ts:491` (manual mode) |
| `WILD_ITEM_AUTO_USED` | `WildItemAutoUsedMeta` | S/s | `instanceId`, `itemId`, `autoReason`, `discarded?`, `forfeited?` | `pickups/engine.ts:491` + `auto-use/execute.ts:256`; discard `auto-use/execute.ts:239-245` |
| `WILD_ITEM_MANUAL_INPUT` | `WildItemManualInputMeta` | S/s | `instanceId`, `clientActionId`, `action`, `applied`, `reason?` | `pickups/engine.ts:514-520` |
| `INSTANT_PICKUP_TRIGGERED` | `WildItemGrantedMeta` | S/— | `pickupId`, `instanceId`, `itemId`, `rank` | `pickups/engine.ts:287` |
| `TAILWIND_STARTED` | `UntilTickMeta` | S/— | `untilTick` (`autoReason?` allowed by the shared struct, never written) | `pickups/engine.ts:281` |
| `TAILWIND_ENDED` | `EmptyMeta` | S/— | — | `pickups/engine.ts:506` |
| `MAGNET_STARTED` | `UntilTickMeta` | S/s | `untilTick` | `pickups/engine.ts:285` |
| `MAGNET_ENDED` | `EmptyMeta` | S/— | — | `pickups/engine.ts:507` |
| `MINI_BUBBLE_ACTIVATED` | `UntilTickMeta` | S/— | `untilTick`, `autoReason?` | `pickups/engine.ts:418` |
| `MINI_BUBBLE_BLOCKED` | `MiniBubbleBlockedMeta` | S/T | `blocked` | `items/engine.ts:668,758` |
| `MINI_BUBBLE_EXPIRED` | `MiniBubbleExpiredMeta` | S/— | `expiryBoost` | `pickups/engine.ts:500` |
| `MINI_ROCKET_FIRED` | `AutoReasonMeta` | S/T | `autoReason?` | `pickups/engine.ts:434` |
| `MINI_ROCKET_HIT` | `RocketHitMeta` | S/T | `shockAbsorbed` | `items/engine.ts:662` |
| `MINI_ROCKET_BLOCKED` | `ProjectileBlockedMeta` | S/T | `defense` | `items/engine.ts:669,673,676` |
| `MINI_ROCKET_EXPIRED` | `EmptyMeta` | S/T | — | `items/engine.ts:581` |
| `WILD_BANANA_DROPPED` | `WildBananaDroppedMeta` | S/— | `id`, `progress`, `lateralOffset`, `autoReason?` | `pickups/engine.ts:441` |
| `WILD_BANANA_HIT` | `BananaHitMeta` | S/T | `lateralSlip`, `shockAbsorbed` | `items/engine.ts:753` |
| `WILD_BANANA_BLOCKED` | `ProjectileBlockedMeta` | S/T | `defense`, `blocked?` | `items/engine.ts:759,763,767` |
| `WILD_BANANA_EXPIRED` | `BananaExpiredMeta` | S/— | `id` | `items/engine.ts:686` |
| `WILD_HORN_USED` | `WildHornUsedMeta` | S/— | `targets`, `side`, `autoReason?` | `pickups/engine.ts:467` |
| `WILD_FEATHER_USED` | `UntilTickMeta` | S/— | `untilTick`, `autoReason?` | `pickups/engine.ts:473` |
| `WILD_FEATHER_DODGED` | `WildFeatherDodgedMeta` | S/s | banana: — ; hazard: `hazardId`, `hazardType` | `items/engine.ts:766`; `pickups/engine.ts:361` |
| `HAZARD_SPAWNED` | `HazardSpawnedMeta` | —/— | `hazardId`, `zoneId`, `hazardType`, `progress`, `lateralOffset`, `radius` | `pickups/engine.ts:216-218` |
| `HAZARD_HIT` | `HazardMeta` | S/— | `hazardId`, `hazardType` | `pickups/engine.ts:369` |
| `HAZARD_DODGED` | `HazardMeta` | S/— | `hazardId`, `hazardType` | `pickups/engine.ts:362` |
| `GOLDEN_BOX_SPAWNED` | `PickupSpawnedMeta` | —/— | as `PICKUP_SPAWNED` | `pickups/engine.ts:211-213` |
| `GOLDEN_BOX_COLLECTED` | `GoldenBoxCollectedMeta` | S/— | `pickupId` | `pickups/engine.ts:333` |
| `QP_TRACK_REWARD_GRANTED` (meta) | `QpTrackRewardGrantedMeta` | S/— | `pickupId`, `amount`, `reason` | `lib/season3-race.ts:446-456` |
| `BOOST_GATE_PASSED` | `BoostGatePassedMeta` | S/— | `gateId`, `laneId`, `tier`, `multiplier`, `durationSeconds`, `colorHex` (number), `colorName`, `label` | `simulation.ts:580-593` |
| `MOMENTUM_STOLEN` | `MomentumStolenMeta` | S (attacker)/T (victim) | `stolenItemId`, `brokeBoost`, `multiplier`, `durationSeconds`, `autoReason?` | `items/engine.ts:322` |
| `GUARD_SURGE` | `GuardSurgeMeta` | S/s | counter: `defenseItemId`, `blocked`, `multiplier`, `durationSeconds`; glide: `defenseItemId`, `glide`, `multiplier`, `durationSeconds` | `items/engine.ts:339,836` |
| `DUCK_TEMPERAMENT` | `DuckTemperamentMeta` | S/— | `temperament` | `simulation.ts:215` |
| `AI_INTENT` | `AiIntentMeta` | S/s | `intent`, `itemId`, `temperament` | `auto-use/arbiter.ts:49` (callers `:140,:176` always pass a string `itemId`) |

Value enums: `AutoUseReason` (`auto-use/types.ts:6-13`), `Temperament`
(`auto-use/brain.ts:9`), `AiIntent` (`brain.ts:48-59`), `BoostBreakSource`
(`items/engine.ts:74`), `IncomingAttack` (`:342`), `GuardDefenseItem`
(`:331`), `BlockDefense`, `ReflexThreat` (`:365`), `PredatorRushTrigger`
(`:377`), `SilenceSource`, `BoostLaneTier` (`track.ts:1`), `WildUseFailure`
(`pickups/engine.ts:71`), `WildItemAction`, `QpRewardReason`, `HornSide`
(serialised as the number −1 or 1, `items/aim.ts:6`).

Numbers: tick-like and count-like keys (`tick`, `untilTick`, `rank`,
`startRank`, `id`, `playerCount`, `remainingBoostTicks`,
`originalBoostTicks`, `slipstreamChargeDestroyedTicks`, `ducksHit`,
`amount`, `colorHex`, `seq`) are `u32`; everything else is `f64`. Rust writes
an integral `f64` as `1.0` where JS writes `1`; consumers parse both the same,
and the digest uses the race-core JCS writer (ryu-js), not `serde_json`.

### Keys the browser reads

| Consumer | Event → keys |
|---|---|
| `lib/racing/combat-encounters.ts` | `*_BLOCKED.defense` (:164, :291), `HORN_USED`/`WILD_HORN_USED.targets` (:354) |
| `lib/racing/post-race-stats.ts` | horn `targets`, `ducksHit` (:124-126); `DUCK_FINISHED.finishTimeMs` (:198); `BOOST_BROKEN.remainingBoostTicks` (:282) |
| `lib/racing/pickup-telemetry.ts` | `WILD_ITEM_GRANTED.instanceId/itemId/rank`, `WILD_ITEM_USED`/`WILD_ITEM_AUTO_USED.instanceId` (:57-72) |
| `lib/racing/persistence.ts` | `WILD_ITEM_MANUAL_INPUT.instanceId/clientActionId` (:45-46) |
| `lib/season3-race.ts` | `GOLDEN_BOX_COLLECTED.pickupId` (:334), `DUCK_FINISHED.finishTimeMs` (:377) |
| `lib/racing/ai-intent-copy.ts` | takes the `AI_INTENT.intent` value (no direct metadata access) |
| `components/racing/race-event-timeline.tsx` | `itemId` (:61), `defense` (:104, :152), `ITEM_SILENCED.durationSeconds` (:283), `hazardType` (:377), `DUCK_FINISHED.finishTimeMs` (:390), `temperament` (:403-415), `AI_INTENT.intent` (:414), `MOMENTUM_STOLEN.multiplier/durationSeconds` (:426-430), `GUARD_SURGE.multiplier/defenseItemId/glide/durationSeconds` (:437-442) |
| `components/racing/phaser-race-canvas.tsx` | `AI_INTENT.intent/itemId` (:942, :1198), `GUARD_SURGE.glide` (:950), `defense` (:988, :1012, :1147-1184), `*BANANA_DROPPED.progress/lateralOffset` (:994), `INSTANT_PICKUP_TRIGGERED.itemId` (:1016-1030, :1174), `hazardType` (:1088, :1192), `BOOST_GATE_PASSED.colorHex/tier/label` (:1114-1115, :1195), `ITEM_SILENCED.durationSeconds` (:1165), `WILD_ITEM_GRANTED.itemId` (:1173, :1210), `WILD_ITEM_MANUAL_INPUT.applied/instanceId/clientActionId` (:1322-1324) |

Reads of keys that no code writes (TS consumer bugs, kept as-is; the
consumers fall back to defaults):

- `race-event-timeline.tsx:253` reads `BOOST_BROKEN.metadata.source`; the
  engine writes `breakSource`. The timeline always shows the rocket text.
- `race-event-timeline.tsx:389` reads `DUCK_FINISHED.metadata.rank`; never
  written, so every finisher gets the 🥇 icon.
- `race-event-timeline.tsx:61` falls back to `metadata.wildItemId`; never
  written.
- `race-event-timeline.tsx:452` reads `CHAOS_RESOLVED.metadata.summary`;
  never written (`lib/season3-race.ts:319-322` writes `chaosType`,
  `loserPlayerIds`).

Phase 4 can fix these against the generated bindings; the Rust protocol does
not add the missing keys.

## Snapshots, results, DTRK, legacy

- **Snapshots** (`snapshot.rs`): field-for-field with the Zod schemas; see
  the table above. `StateSnapshotMessage.type` is the single-variant enum
  `StateSnapshotType` (`"STATE_SNAPSHOT"`).
- **Results** (`result.rs`): `RaceResult.events` are `RaceEvent`s, so they
  carry `seq`. `DigestEnvelope` follows D9 exactly; field order is irrelevant
  because race-core's JCS writer sorts keys.
- **DTRK/1** (`replay_track.rs`): magic `DTRK`, `u16` version 1, `u16` flags,
  `u32` header length, sorted-key header JSON, then `u8 id | u32 len | bytes`
  sections. `DtrkHeader` declares its fields in UTF-16 sorted order so
  `serde_json` writes sorted keys; `resultDigest`, `engine.build` and
  `engine.commit` are written as `null`, never omitted. `source` is
  `LIVE_TS | BACKFILL | LIVE_RUST`, `fidelity` is
  `RECORDED | VERIFIED_DIGEST | VERIFIED_EVENTS | UNAVAILABLE`, `engine.impl`
  is `ts | rust`. Section ids (1-5), change kinds (1-4) and flag bit 0
  (`FLAG_ENTITY_PER_SAMPLE`) are provisional until
  `lib/racing/replay-track/format.ts` lands on main (Phase 0.4).
- **Legacy** (`legacy.rs`): every field is optional or defaults, every known
  field is converted best-effort through `LegacyJson` (a wrong type becomes
  the default, a number satisfies a string field, unconvertible list entries
  are dropped), unknown keys are kept in `extra` and written back. Item,
  chaos and source names stay strings. Only non-object input fails.

## ts-rs bindings

`cargo test -p race-protocol --features ts-export` writes 115 `.ts` files to
`crates/race-protocol/bindings/` (one per exported type). Omittable keys are
`key?: T`; `null`-able keys are `key: T | null`; `draftTarget` and the legacy
`targetPlayerId` are `key?: T | null`. Ids export as `string`, `HornSide` as
`-1 | 1`, `RaceEvent` as `{…} & ({type: "RACE_STARTED", metadata: RaceStartedMeta} | …)`.
The legacy `extra` maps are skipped in the bindings (no index signature).

## Verification

`crates/race-protocol/tests/`:

| Test | What | Result |
|---|---|---|
| `ts_oracle_roundtrip::full_race_events_round_trip` | 5 full TS races (4-9 players; Chaos NORMAL, REVERSE, DUO, TRIPLE_ELIMINATION, CONSTRUCTORS; manual inputs in the last), every event | 1,553 / 1,553 identical (100%) |
| `ts_oracle_roundtrip::event_variants_round_trip` | one event per distinct (type, keys, value shapes) over 400 TS races (all 7 Chaos types, 4-12 players, ghosts, forced golden boxes, item tuning, manual inputs every 10th race) | 98 / 98 identical (100%), 63 types |
| `ts_oracle_roundtrip::all_oracle_events_round_trip` (ignored; needs `RACE_PROTOCOL_ALL_EVENTS`) | every event of the 400 races | 178,921 / 178,921 identical (100%) |
| `ts_oracle_roundtrip::handwritten_events_round_trip_and_cover_every_type` | 9 events the corpus never produces (rocket expiry, both meta events, both unemitted types, `draftTarget: null`, `replacedItemId`, `intact`) | 9 / 9; 69 / 69 types covered |
| `ts_oracle_roundtrip::snapshots_round_trip` | `STATE_SNAPSHOT` every 180 ticks | 102 / 102 identical |
| `ts_oracle_roundtrip::results_round_trip` | `RaceResult` incl. events | 5 / 5 |
| `ts_oracle_roundtrip::configs_resolve_like_the_ts_engine` | input → `resolve()` vs Zod parse; stored Zod config → `LegacyEngineVersion` and lossless `LegacyRaceConfigV1` | 5 / 5 |
| `event_wire_keys` | pinned key table for all 69 types: max/min key sets, `null` keys, missing required keys rejected, unknown keys rejected, `seq` required | 7 tests |
| `ids_config`, `legacy_and_track` | D6 ids, D8 defaults and ranges, 17-digit floats, legacy leniency, DTRK container | 16 tests |

"Identical" means: same top-level keys, same metadata keys, and every number
bit-equal as f64 (strings, booleans and nulls equal).

Regenerate the fixtures with
`node --import tsx crates/race-protocol/tests/fixtures/ts-oracle/dump-protocol-fixtures.mts . crates/race-protocol/tests/fixtures/ts-oracle 400`
(deterministic; ~35 s).
