import { EventEmitter } from 'events'

class RaceEventBus extends EventEmitter { }

// Singleton instance
export const raceEventBus = new RaceEventBus()

// Event types
export const RACE_EVENTS = {
  FRAME: 'frame', // Payload: { raceId, base64 }
  COMMENTARY: 'commentary', // Payload: { raceId, text, timestamp }
  STATUS: 'status', // Payload: { raceId, status }
  FINISHED: 'finished', // Payload: { raceId, winner, victims, verdict }
}
