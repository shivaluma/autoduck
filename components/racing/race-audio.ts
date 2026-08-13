import type { RaceEventType } from '@/packages/race-protocol/src'

type SoundCue = 'COUNTDOWN' | 'START' | 'ROCKET_LAUNCH' | 'ROCKET_IMPACT' | 'SHIELD_POP' | 'BANANA_SLIP' | 'NITRO' | 'HORN' | 'FINISH'

const EVENT_CUES: Partial<Record<RaceEventType, SoundCue>> = {
  ROCKET_FIRED: 'ROCKET_LAUNCH',
  ROCKET_HIT: 'ROCKET_IMPACT',
  BUBBLE_POPPED: 'SHIELD_POP',
  BANANA_HIT: 'BANANA_SLIP',
  NITRO_STARTED: 'NITRO',
  HORN_USED: 'HORN',
  RACE_FINISHED: 'FINISH',
}

const CUE_TUNING: Record<SoundCue, { frequency: number; endFrequency: number; duration: number; type: OscillatorType; volume: number }> = {
  COUNTDOWN: { frequency: 520, endFrequency: 520, duration: 0.09, type: 'square', volume: 0.035 },
  START: { frequency: 440, endFrequency: 880, duration: 0.24, type: 'triangle', volume: 0.055 },
  ROCKET_LAUNCH: { frequency: 180, endFrequency: 620, duration: 0.2, type: 'sawtooth', volume: 0.035 },
  ROCKET_IMPACT: { frequency: 130, endFrequency: 70, duration: 0.18, type: 'square', volume: 0.04 },
  SHIELD_POP: { frequency: 760, endFrequency: 1180, duration: 0.13, type: 'sine', volume: 0.045 },
  BANANA_SLIP: { frequency: 620, endFrequency: 210, duration: 0.2, type: 'triangle', volume: 0.04 },
  NITRO: { frequency: 210, endFrequency: 720, duration: 0.3, type: 'sawtooth', volume: 0.03 },
  HORN: { frequency: 260, endFrequency: 210, duration: 0.22, type: 'square', volume: 0.035 },
  FINISH: { frequency: 640, endFrequency: 960, duration: 0.36, type: 'triangle', volume: 0.05 },
}

export class RaceAudioSystem {
  private context: AudioContext | null = null
  private lastPlayedAt = new Map<SoundCue, number>()

  async unlock() {
    this.context ??= new AudioContext()
    if (this.context.state === 'suspended') await this.context.resume()
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
