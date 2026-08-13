import Image from 'next/image'

function initials(name: string) {
  return name
    .replace(/^Zịt\s+/i, '')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function Season3Avatar({ name, avatarUrl, size = 40 }: { name: string; avatarUrl?: string | null; size?: number }) {
  return avatarUrl ? (
    <Image
      src={avatarUrl}
      alt={name}
      width={size}
      height={size}
      unoptimized
      className="rounded-full border-2 border-white/20 object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border-2 border-white/20 bg-white/10 text-xs font-black text-white"
      style={{ width: size, height: size }}
      aria-label={name}
    >
      {initials(name)}
    </span>
  )
}
