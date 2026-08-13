# Race Pickups — S3.7

Quack Boxes add readable, temporary race chaos without changing persistent power. The race core owns every spawn, collision, loot roll, target, effect, and Golden QP award. Phaser only renders authoritative snapshots and events.

## Visual language

- Blue `?`: beneficial Quack Box.
- Gold coin box + beam: Golden Quack Box, at most one per official race and worth exactly `+1 QP`.
- Red/purple authored object: visible Track Hazard.
- Purple Chaos Box: architecture exists, disabled in Normal races.
- Gameplay icons and effects always render above cosmetic layers.

Original lightweight SVGs live in `public/race-pickups`. Validate them with `pnpm race:validate-pickups`.

## Deterministic world

`createRiverTrack()` declares four pickup zones around 20%, 42%, 64%, and 82%, each with five lateral anchors. Hazard zones are authored separately. `createPickupRaceState()` selects anchors before the race from independent streams:

```text
pickup-spawn:{raceId}
pickup-loot:{raceId}:{pickupId}:{collectorPlayerId}
gold-box:{raceId}
hazards:{raceId}
```

Gameplay never calls `Math.random()`. Cosmetic changes cannot advance a gameplay stream. Immutable race config records `pickupSpawnVersion`, `wildItemBalanceVersion`, `hazardBalanceVersion`, and the track version.

A collision is resolved by distance to the pickup center, crossing fraction within the tick, then stable player ID. Standard boxes are single-use. A duck can collect at most three regular pickups and cannot touch another standard box while holding a Wild Item; that box remains for another duck. Golden Boxes ignore the slot and cap.

## Wild Slot and loot

Each duck has one race-only Wild Slot. Held items occupy it; instant items trigger immediately. Position-aware category weights provide mild comeback support but no scripted comeback:

| Rank bucket | Attack | Defense | Mobility | Utility |
| --- | ---: | ---: | ---: | ---: |
| Front | 26% | 34% | 18% | 22% |
| Middle | 34% | 20% | 28% | 18% |
| Back | 30% | 16% | 44% | 10% |

The launch pool is exactly eight items:

| Item | Kind | Effect |
| --- | --- | --- |
| Mini Nitro | Instant | Short +12% boost |
| Tailwind | Instant | Smoother +8% boost |
| Mini Bubble | Held | Blocks one eligible Wild attack, expires after 7s |
| Mini Rocket | Held | Nearest eligible duck ahead, -28% slow for 1.8s |
| Banana | Held | Six-second trap, -35% slow for 1.8s and small slip |
| Quack Horn | Held | Small lateral pack push |
| Feather | Held | Dodges one Banana or minor hazard during 5s |
| Slipstream Magnet | Instant | Small acceleration toward the nearest wake |

Positive speed is capped at `+25%`; negative speed at `-45%`. Overlapping slows use the strongest value. Offensive hits grant 1s item immunity, and Rocket hits grant two-second Rocket target protection. No pickup can stop, reverse, teleport, or remove a duck.

## Manual and automatic use

The personal Season 3 page enters Live Race mode and polls the authoritative persisted snapshot. `USE NOW` submits only:

```json
{
  "wildItemInstanceId": "server-issued-id",
  "clientActionId": "idempotency-id"
}
```

`POST /api/races/:id/wild-item` validates the personal token, race ownership/state, item instance, and five-actions-per-second limit. It writes an idempotent `RaceWildAction`; the race worker claims it and executes it on the next simulation tick. The client never supplies a target. Invalid uses do not consume the item.

Auto-use is always on in official races. Rocket checks range (widening in the final stretch), Banana checks a nearby duck behind or drops before the finish, Bubble checks incoming attacks or activates for leaders in the end game, Horn checks pack density with expanded radius near the finish, and Feather checks approaching traps/hazards or burns before the line. Ideal-manual players get a short extra window, then the same burn rules apply. A second auto-use pass runs immediately after pickup collection so late boxes are not carried to the finish. Disconnecting the personal page does not affect auto-use.

Applied manual commands emit `WILD_ITEM_MANUAL_INPUT` with their authoritative tick. Replays extract those events and inject the same command at the same tick.

## Hazards and Golden QP

Normal races spawn zero to two hazards, weighted toward zero or one. Anchor, Whirlpool, Ice Patch, and Sticky Goo have distinct silhouettes and mild bounded effects. Authored anchors always leave safe lateral space.

Golden Box spawn probability defaults to 15%, at 35–75% progress. Official collection creates one idempotent `CurrencyTransaction`:

```text
reason: TRACK_GOLDEN_BOX
key: race:{raceId}:golden-box:{pickupId}
amount: +1
```

Test/practice races render and replay Golden Boxes but never mutate QP.

## Runtime, replay, and telemetry

Snapshots contain ducks, active/collected boxes, hazards, Wild Slot state, pickup count, and active effects. Events persist independently for reconnecting SSE viewers. Object visuals and particles are pooled or short-lived client objects; no particle is networked.

Official races persist one `RacePickupTelemetry` row per item instance: collection rank, use mode, hit/success, final rank, and same-seed pickup-off rank. Admin Item Balance shows activation, hit, manual/auto use, and average rank delta.

Run balancing with:

```bash
pnpm race:simulate-pickups --races 100000
```

The report includes pickup distribution, item/rank buckets, winner and loser changes, rank swing, hit/block rates, hazards, Golden QP inflation, hit chains, and a real ideal-manual policy approximation.

## Developer Race Lab

`/dev/race-lab` exposes boxes, Golden Box, forced Gold, hazards, position-aware loot, auto-use, spawn multiplier, and forced item controls. The canvas shows pickup/hazard anchors and collision radii. State inspector shows each Wild Slot and pickup count; the event log shows authoritative event order.

## Extension checklist

New Wild Item:

1. Add protocol ID and catalog definition.
2. Add a registry handler and auto-use policy.
3. Add a bold 64×64 icon and readable VFX/SFX cue.
4. Add interaction, determinism, invalid-use, and balance tests.

New hazard:

1. Add protocol type and balance config.
2. Add it to authored hazard-zone `allowedTypes`.
3. Add collision behavior, asset, event copy, and tests.

New box type:

1. Add protocol type and explicit visual identity.
2. Add a spawn policy without changing standard-box semantics.
3. Add authoritative collection handling, replay events, and tests.

Never couple pickup odds or strength to QP, cosmetics, Scar, Season Shield, account age, identity, wins, or collection size. Persistent progression remains cosmetic-only.
