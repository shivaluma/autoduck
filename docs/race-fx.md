# Race FX v2

Visual layer of the Phaser race canvas (`components/racing/phaser-race-canvas.tsx`). Purely cosmetic: nothing here reads into the simulation.

## Assets
- `lib/race-fx/manifest.ts` lists every sprite sheet (key, frames, fps, size, loop), item icon and bank decor. Both the generator and the canvas read it.
- `scripts/race-fx/art.ts` has one hand-drawn SVG per entry, in a 256×256 viewBox, using the cosmetics kit. Each animation's period equals its sheet duration (`frames / fps`), so loops are seamless and one-shots play exactly once.
- `pnpm race:fx` bakes the SMIL animation into sprite sheets (`public/race-fx/sheets`) and writes the static icons and decor. Generation fails on:
  - duplicate SVG ids
  - kebab-cased SMIL attributes
  - malformed timelines (keyTimes must start at 0, end at 1 and match the number of values; browsers silently ignore them otherwise).
- `/dev/race-fx` plays every loop, re-fires every one-shot and shows the icon, decor and callout styles.

## In the canvas (`components/racing/race-fx.ts`)
- **World:** grass meadow, sand banks, layered water, sun glints (particles near the camera), seeded decor, checkered start/finish, boost gates with chasing chevrons.
- **Themes** (`lib/race-fx/themes.ts`): each race picks one at random, seeded by its race id (`pickRaceTheme`) so live viewers and replays agree. A theme sets the ground (tufts or a neon city grid), bank and water colours, foam, currents, glint/wake tints, weighted bank/water decor and optional screen-space weather. Purely visual, so no balance bump. Force one with the canvas `theme` prop or the THEME picker in `/dev/race-lab`.

  | Theme | Look | Weather |
  |---|---|---|
  | 🌿 Duck Pond | the original meadow river | — |
  | 🌃 Neon Canal | night city grid, magenta/cyan neon banks, lamps, signs, rooftops, buoys | neon rain |
  | 🌸 Sakura Garden | jade water, stone banks, cherry trees, lanterns, koi, petal rafts | falling petals |
  | ❄️ Aurora Glacier | snowfield, ice banks, snowy pines, snowmen, ice floes, penguins | snowfall |
  | 🌴 Sunset Lagoon | turquoise shallows, wide beach, palms, tiki torches, hibiscus, coconuts | golden motes |
- **Crowd** (`components/racing/race-crowd.ts`): cartoon fans along both banks whose faces are the competitors' real avatars (`avatarUrl`, ghosts excluded). Real players' avatars load through `/api/avatars/[userId]`, a same-origin proxy that only fetches the URL stored on that user, because Google, Slack and R2 send no CORS headers and WebGL can't read them directly. If loading still fails, the fan gets an initials face. The layout is seeded (`planCrowd`), and bank decor is kept out of crowd spans. Fans sway and clap while they wait, raise their arms as the pack passes, and jump and throw confetti when their own duck goes by. With reduced motion they stand still.
- **Ducks:**
  - bob on the water, lean into turns, foam wake particles (busier while boosting)
  - medal rank badges and icon loadout badges (used items pop away)
  - wild-item badge
  - status overlays:

    | Effect | Overlay |
    |---|---|
    | Nitro, Mini Nitro, Predator Rush | Nitro flame |
    | Tailwind, Magnet, Draft Fin, Paddle Burst | Wind streaks |
    | Bubble Shield, Mini Bubble | Shield bubble |
    | Slowed | Dizzy stars |
    | Silenced | Muted marker |
    | Feather | Orbiting feathers |
    | Targeted by a rocket | Target lock |
- **Objects:** animated Quack, Golden and Chaos boxes; hazards; rockets oriented along their flight path with a smoke trail; floating banana peels.
- **Events:** one-shot effect, spark particles, comic callout ("BOOM!", "NITRO!", "SLIP!", "+1 QP"), and camera shake/flash on big hits. Effects are scaled by `FX_SCALE` for the pack-framing camera.
- **River events** (engine S3.17, `components/racing/river-event-fx.ts`; art in `scripts/race-fx/river-art.ts`): a banner plate drops in with the event's icon (`river-flood`, `river-whirlpool`, `river-gust`, `river-bread`), hazard tape and a 3-2-1 count while the event is announced, then a timer bar while it runs. The screen gets a tint and weather (rain, wind streaks and leaves, spray pulled to the centre, falling loaves). Every duck the event speeds up or slows down gets a sprite parented to its container and a "▲ +13%" / "▼ -22%" pill:

  | Event | On the duck |
  |---|---|
  | Flash flood | `river-surf` wave pushing from behind, sized by the push; splashes |
  | Whirlpool | `river-vortex` under the duck; the duck wobbles |
  | Gust | `river-gust` curls behind (tailwind, green) or in front (headwind, red, flipped) |
  | Bread rain | `river-bread` loaf to chase; "NOM!" callouts and splashes |
- **Reduced motion:** with `prefers-reduced-motion`, particles, bobbing, shakes and flashes are skipped; callouts fade in place.

Item icons are also used in the UI through `components/racing/race-item-icon.tsx`: the loadout picker, the rules guide and the wild-item panel.
