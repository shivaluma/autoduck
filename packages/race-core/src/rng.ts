function hashString(value: string) {
  let hash = 2166136261 >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  hash += hash << 13
  hash ^= hash >>> 7
  hash += hash << 3
  hash ^= hash >>> 17
  hash += hash << 5
  return hash >>> 0
}

function splitMix32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x9e3779b9) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad)
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97)
    return (value ^ (value >>> 15)) >>> 0
  }
}

export class DeterministicRng {
  private state: number

  constructor(seed: string) {
    const expand = splitMix32(hashString(seed))
    this.state = expand() || 0x6d2b79f5
  }

  nextUint32() {
    let value = this.state
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.state = value >>> 0
    return this.state
  }

  next() {
    return this.nextUint32() / 0x100000000
  }

  range(minimum: number, maximum: number) {
    return minimum + (maximum - minimum) * this.next()
  }

  integer(minimum: number, maximumInclusive: number) {
    return minimum + Math.floor(this.next() * (maximumInclusive - minimum + 1))
  }
}

export function createRaceRng(seed: string, stream: string) {
  return new DeterministicRng(`${seed}:${stream}`)
}
