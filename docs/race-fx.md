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
- **Reduced motion:** with `prefers-reduced-motion`, particles, bobbing, shakes and flashes are skipped; callouts fade in place.

Item icons are also used in the UI through `components/racing/race-item-icon.tsx`: the loadout picker, the rules guide and the wild-item panel.
