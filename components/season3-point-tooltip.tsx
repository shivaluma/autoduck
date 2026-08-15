export function Season3PointTooltip() {
  return <span className="group relative inline-flex align-middle">
    <button type="button" aria-label="Khi nào nhận Điểm Tiên Tri?" className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--color-ggd-lavender)]/60 text-[10px] font-black text-[var(--color-ggd-lavender)]">?</button>
    <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-xl border border-[var(--color-ggd-lavender)]/40 bg-[#17102f] p-3 text-left text-xs font-bold leading-relaxed text-white opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-within:opacity-100">
      Nhận <span className="text-[var(--color-ggd-lavender)]">+1 🔮</span> khi người bạn chọn cán đích ở <b>2 vị trí cuối cùng</b> trên đường đua. Nếu người đó đồng thời bị lá bài Chaos xử thua, bạn nhận thêm tiền thưởng 🪙 QP!
    </span>
  </span>
}
