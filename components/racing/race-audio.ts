import type { RaceEventType } from '@/src/engine/protocol'

type SoundCue = 'COUNTDOWN' | 'START' | 'BOX_POP' | 'ITEM_REVEAL' | 'ROCKET_LAUNCH' | 'ROCKET_IMPACT' | 'SHIELD_POP' | 'BANANA_SLIP' | 'NITRO' | 'TAILWIND' | 'HORN' | 'FEATHER' | 'HAZARD' | 'GOLD_AMBIENT' | 'GOLD_REWARD' | 'FINISH'

const EVENT_CUES: Partial<Record<RaceEventType, SoundCue>> = {
  ROCKET_FIRED: 'ROCKET_LAUNCH',
  ROCKET_HIT: 'ROCKET_IMPACT',
  BUBBLE_SHIELD_ACTIVATED: 'SHIELD_POP',
  BUBBLE_POPPED: 'SHIELD_POP',
  BANANA_HIT: 'BANANA_SLIP',
  NITRO_STARTED: 'NITRO',
  BOOST_BROKEN: 'ROCKET_IMPACT',
  HORN_USED: 'HORN',
  ITEM_SILENCED: 'HORN',
  PREDATOR_RUSH_STARTED: 'NITRO',
  PICKUP_COLLECTED: 'BOX_POP',
  WILD_ITEM_GRANTED: 'ITEM_REVEAL',
  INSTANT_PICKUP_TRIGGERED: 'ITEM_REVEAL',
  MINI_ROCKET_FIRED: 'ROCKET_LAUNCH',
  MINI_ROCKET_HIT: 'ROCKET_IMPACT',
  MINI_ROCKET_BLOCKED: 'SHIELD_POP',
  WILD_BANANA_HIT: 'BANANA_SLIP',
  MINI_BUBBLE_ACTIVATED: 'SHIELD_POP',
  MINI_BUBBLE_BLOCKED: 'SHIELD_POP',
  TAILWIND_STARTED: 'TAILWIND',
  WILD_HORN_USED: 'HORN',
  WILD_FEATHER_DODGED: 'FEATHER',
  HAZARD_HIT: 'HAZARD',
  GOLDEN_BOX_SPAWNED: 'GOLD_AMBIENT',
  GOLDEN_BOX_COLLECTED: 'GOLD_REWARD',
  RACE_FINISHED: 'FINISH',
}

const CUE_TUNING: Record<SoundCue, { frequency: number; endFrequency: number; duration: number; type: OscillatorType; volume: number }> = {
  COUNTDOWN: { frequency: 520, endFrequency: 520, duration: 0.09, type: 'square', volume: 0.035 },
  START: { frequency: 440, endFrequency: 880, duration: 0.24, type: 'triangle', volume: 0.055 },
  BOX_POP: { frequency: 360, endFrequency: 920, duration: 0.12, type: 'square', volume: 0.035 },
  ITEM_REVEAL: { frequency: 620, endFrequency: 980, duration: 0.18, type: 'triangle', volume: 0.035 },
  ROCKET_LAUNCH: { frequency: 180, endFrequency: 620, duration: 0.2, type: 'sawtooth', volume: 0.035 },
  ROCKET_IMPACT: { frequency: 130, endFrequency: 70, duration: 0.18, type: 'square', volume: 0.04 },
  SHIELD_POP: { frequency: 760, endFrequency: 1180, duration: 0.13, type: 'sine', volume: 0.045 },
  BANANA_SLIP: { frequency: 620, endFrequency: 210, duration: 0.2, type: 'triangle', volume: 0.04 },
  NITRO: { frequency: 210, endFrequency: 720, duration: 0.3, type: 'sawtooth', volume: 0.03 },
  TAILWIND: { frequency: 340, endFrequency: 540, duration: 0.28, type: 'sine', volume: 0.028 },
  HORN: { frequency: 260, endFrequency: 210, duration: 0.22, type: 'square', volume: 0.035 },
  FEATHER: { frequency: 820, endFrequency: 1180, duration: 0.17, type: 'sine', volume: 0.032 },
  HAZARD: { frequency: 180, endFrequency: 90, duration: 0.2, type: 'sawtooth', volume: 0.032 },
  GOLD_AMBIENT: { frequency: 880, endFrequency: 1040, duration: 0.3, type: 'sine', volume: 0.022 },
  GOLD_REWARD: { frequency: 520, endFrequency: 1320, duration: 0.42, type: 'triangle', volume: 0.05 },
  FINISH: { frequency: 640, endFrequency: 960, duration: 0.36, type: 'triangle', volume: 0.05 },
}

const MUSIC_VOLUME = 0.22
const MUSIC_MUTED_KEY = 'autoduck:race-music-muted'

export class RaceAudioSystem {
  private context: AudioContext | null = null
  private lastPlayedAt = new Map<SoundCue, number>()
  private music: HTMLAudioElement | null = null

  /** `musicUrl`: the race's looping background track (see `race-music.ts`); omitted means no music. */
  constructor(private readonly musicUrl?: string) {}

  async unlock() {
    // Start the music before any await so it still counts as part of the user's tap (Safari).
    this.startMusic()
    this.context ??= new AudioContext()
    if (this.context.state === 'suspended') await this.context.resume()
  }

  /** The viewer's music mute, remembered across races in this browser. */
  get musicMuted(): boolean {
    try {
      return localStorage.getItem(MUSIC_MUTED_KEY) === '1'
    } catch {
      return false
    }
  }

  /** Flips the music mute and returns the new state. Sound effects are unaffected. */
  toggleMusic(): boolean {
    const muted = !this.musicMuted
    try {
      localStorage.setItem(MUSIC_MUTED_KEY, muted ? '1' : '0')
    } catch {
      // Storage blocked: the toggle still applies to this race.
    }
    if (muted) this.music?.pause()
    else this.startMusic(true)
    return muted
  }

  countdown(start = false) {
    this.play(start ? 'START' : 'COUNTDOWN')
  }

  raceEvent(type: RaceEventType) {
    const cue = EVENT_CUES[type]
    if (cue) this.play(cue)
  }

  close() {
    void this.context?.close()
    this.context = null
    if (this.music) {
      this.music.pause()
      this.music.removeAttribute('src')
      this.music.load()
      this.music = null
    }
  }

  private startMusic(force = false) {
    if (!this.musicUrl || typeof Audio === 'undefined' || (!force && this.musicMuted)) return
    if (!this.music) {
      this.music = new Audio(this.musicUrl)
      this.music.loop = true
      this.music.volume = MUSIC_VOLUME
    }
    void this.music.play().catch(() => {
      // Autoplay refused or the file failed to load: the race just stays silent.
    })
  }

  private play(cue: SoundCue) {
    const context = this.context
    if (!context || context.state !== 'running') return
    const nowMs = performance.now()
    const throttleMs = cue === 'ROCKET_IMPACT' || cue === 'BANANA_SLIP' ? 150 : 90
    if (nowMs - (this.lastPlayedAt.get(cue) ?? -Infinity) < throttleMs) return
    this.lastPlayedAt.set(cue, nowMs)

    const tuning = CUE_TUNING[cue]
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = tuning.type
    oscillator.frequency.setValueAtTime(tuning.frequency, context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(tuning.endFrequency, context.currentTime + tuning.duration)
    gain.gain.setValueAtTime(tuning.volume, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + tuning.duration)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + tuning.duration)
  }
}
