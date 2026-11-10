import { harness } from './harness'

export async function storeRecordedReplayTrack(input: { raceId: number; resultDigest: string }) {
  harness().record('storeRecordedReplayTrack', { raceId: input.raceId, resultDigest: input.resultDigest })
}
