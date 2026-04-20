export function isImmortalDuck(args: { name: string; shields?: number | null }) {
  return args.name === 'Thomas' || (args.shields ?? 0) >= 9999
}
