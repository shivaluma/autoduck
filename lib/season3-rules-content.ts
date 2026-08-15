import { RACE_ITEM_CATALOG } from '@/packages/race-core/src/items/catalog'
import { WILD_ITEM_CATALOG } from '@/packages/race-core/src/pickups/catalog'

export const SEASON3_RULES_META = {
  title: 'Luật Chơi Season 3',
  subtitle: 'Cẩm nang toàn tập: Vòng tuần, lá bài Chaos, nghệ thuật chọn đồ Loadout và bí kíp sinh tồn tại Ao Dzịt.',
  weeks: 12,
}

export const QUICK_START_STEPS = [
  {
    step: '01',
    icon: '🃏',
    title: 'Xem Chaos Tuần',
    body: 'Mỗi tuần một lá bài Chaos được lật mở, thay đổi hoàn toàn điều kiện ai sẽ là người "bị làm dzịt" (nhóm thua cuộc).',
  },
  {
    step: '02',
    icon: '🎒',
    title: 'Chuẩn Bị Ra Trận',
    body: 'Chọn 2 item Loadout (3 Prep Credits), quyết định có kích hoạt Khiên (Shield) cứu mạng hay không, và gửi 1 dự đoán bí mật.',
  },
  {
    step: '03',
    icon: '🏁',
    title: 'Xem Đua & Dùng Wild Item',
    body: 'Đường đua diễn ra tự động. Khi xem live, bạn có thể bấm "USE NOW" để tự tay kích hoạt Wild Item nhặt được hoặc để vịt tự dùng.',
  },
  {
    step: '04',
    icon: '🏆',
    title: 'Nhận Điểm & Mua Sắm',
    body: 'Kết quả đường đua được áp vào lá Chaos: trao Sẹo/Khiên, cộng điểm vô địch, thưởng Prediction Points và Quack Points (QP) để sắm skin.',
  },
] as const

export const CHAOS_CARDS = [
  {
    id: 'NORMAL',
    icon: '🏁',
    name: 'NORMAL',
    headline: 'Luật kinh điển: 2 người về cuối cùng thua',
    summary: 'Hai vịt cán đích chậm nhất trên đường đua (Bottom 2) sẽ bị làm dzịt.',
    tip: 'Chỉ cần bơi đừng để rơi vào 2 vị trí bét bảng là an toàn tuyệt đối.',
  },
  {
    id: 'REVERSE',
    icon: '🔄',
    name: 'REVERSE',
    headline: 'Đảo ngược cõi đời: 2 người về ĐẦU TIÊN thua',
    summary: 'Thứ hạng bị lật ngược hoàn toàn! 2 vịt về nhất và nhì trên đường đua trở thành nạn nhân bị làm dzịt.',
    tip: 'Tuần này ai bơi nhanh là tự hại mình — hãy chọn đồ kìm hãm tốc độ hoặc nhường đường cho bạn bè!',
  },
  {
    id: 'DUO',
    icon: '🤝',
    name: 'DUO',
    headline: 'Ghép đôi sinh tử: Cặp có tổng hạng tệ nhất cùng thua',
    summary: 'Trước race, các vịt được bốc thăm ngẫu nhiên thành từng cặp (nếu lẻ người sẽ có một nhóm 3). Cặp nào có tổng thứ hạng lớn nhất (chậm nhất) sẽ cùng nhau dính đòn.',
    tip: 'Nếu đồng đội của bạn bơi quá chậm, hãy cố gắng về top thật cao để gánh tổng điểm của cả cặp.',
  },
  {
    id: 'TRIPLE_ELIMINATION',
    icon: '💀',
    name: 'TRIPLE ELIMINATION',
    headline: 'Thanh trừng diện rộng: 3 người về cuối cùng thua',
    summary: 'Áp lực sinh tồn tăng cao khi cả 3 vịt về chậm nhất (Bottom 3) đều bị làm dzịt.',
    tip: 'Cạnh tranh vị trí thứ 4 từ dưới lên sẽ cực kỳ khốc liệt — một pha dùng item lỗi là trả giá ngay.',
  },
  {
    id: 'CUT_LINE',
    icon: '🚧',
    name: 'CUT LINE',
    headline: 'Nhát cắt 50%: Nửa dưới bảng xếp hạng cùng thua',
    summary: 'Chỉ Top 50% vịt về trước là an toàn. Tất cả những ai rơi vào nửa sau của đoàn đua đều bị xử thua.',
    tip: 'Ranh giới giữa sống và chết nằm ngay giữa đoàn — hãy dồn hết tài nguyên để bứt phá lên nửa trên!',
  },
  {
    id: 'CONSTRUCTORS',
    icon: '🏎️',
    name: 'CONSTRUCTORS',
    headline: 'Đại chiến đội đua: Toàn bộ team có tổng hạng tệ hơn cùng thua',
    summary: 'Toàn bộ đấu thủ được chia ngẫu nhiên thành 2 đội. Đội có tổng thứ hạng lớn hơn (tệ hơn) sẽ thua cả đội. Nếu hòa điểm, cả 2 đội cùng dính đòn!',
    tip: 'Tinh thần đồng đội lên ngôi — mỗi bậc thứ hạng của từng thành viên đều quyết định số phận cả đội.',
  },
  {
    id: 'BOUNTY_HUNT',
    icon: '🎯',
    name: 'BOUNTY HUNT',
    headline: 'Truy lùng mục tiêu (Wanted): Cả làng ngắm vào một người',
    summary: 'Một vịt được chọn làm "Kẻ Bị Truy Nã" (Wanted). Nếu Wanted vào được Top 50%: Wanted an toàn, 2 người bét bảng thua. Nếu Wanted rớt khỏi Top 50%: Wanted và TẤT CẢ những ai về sau Wanted đều bị xử thua!',
    tip: 'Nếu bạn là Wanted, hãy bơi thục mạng vào Top 50! Nếu bạn là người khác, hãy cẩn thận kẻo bị Wanted kéo chìm theo.',
  },
] as const

export const SCAR_SHIELD_RULES = [
  {
    icon: '🩹',
    title: 'Sẹo (Scar) — Dấu ấn thất bại',
    points: [
      'Mỗi lần bạn rơi vào nhóm thua của lá Chaos tuần đó (mà không có Khiên bảo vệ), bạn nhận +1 Sẹo.',
      'Sẹo là lời nhắc nhở về những lần "lên dĩa", nhưng đừng nản lòng — nỗi đau sẽ hóa thành sức mạnh phòng thủ!',
    ],
  },
  {
    icon: '🛡️',
    title: 'Khiên (Shield) — Lá chắn cứu mạng',
    points: [
      'Cứ tích lũy đủ 2 Sẹo, hệ thống sẽ tự động rèn thành 1 Khiên bảo vệ cho bạn.',
      'Cách dùng: Trước khi race diễn ra (ở bước Chuẩn Bị), bạn tick chọn kích hoạt Khiên.',
      'Cơ chế tiêu hao: Khi đã chọn dùng, Khiên LUÔN LUÔN TIÊU HAO (-1 Khiên) sau race đó, bất kể bạn về nhất hay về bét.',
      'Cơ chế bảo vệ: Nếu tuần đó bạn dính vào danh sách thua của Chaos, Khiên sẽ đỡ trọn vẹn cú đánh và bạn KHÔNG bị nhận Sẹo (+0 Sẹo).',
      'Độc lập & an toàn: Khiên chỉ bảo vệ chính bạn và không chuyển hình phạt sang người chơi khác.',
    ],
  },
] as const

export const LOADOUT_CONFIG = {
  credits: 3,
  slots: 2,
  formula: '1 Major Item (2 Credits) + 1 Minor Item (1 Credit)',
  triangle: [
    {
      type: 'SPEED',
      icon: '⚡',
      name: 'Tốc độ (Speed)',
      counters: 'Thắng Phòng thủ 🛡️ (Phòng thủ không chặn được tốc độ bơi vượt lên)',
      items: 'Nitro, Draft Fin, Paddle Burst',
    },
    {
      type: 'DEFENSE',
      icon: '🛡️',
      name: 'Phòng thủ (Defense)',
      counters: 'Thắng Tấn công 💥 (Chặn và giảm thiểu tối đa sát thương từ đòn đánh)',
      items: 'Bubble Shield, Feather, Shock Absorber',
    },
    {
      type: 'ATTACK',
      icon: '💥',
      name: 'Tấn công (Attack)',
      counters: 'Thắng Tốc độ ⚡ (Rocket có Boost Break lập tức dập tắt đợt tăng tốc)',
      items: 'Homing Rocket, Banana, Quack Horn',
    },
  ],
  items: RACE_ITEM_CATALOG,
}

export const TRACK_BOXES = [
  {
    icon: '❓',
    name: 'Quack Box (Hộp Xanh)',
    tag: 'Tối đa 3 hộp / vịt',
    color: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
    description: 'Hộp bí ẩn xuất hiện tại 4 cụm trên đường đua (quanh 20%, 42%, 64% và 82% chặng đua). Mở ra 1 trong 8 loại Wild Item. Vị trí bơi càng ở sau càng dễ nhặt đồ tăng tốc và tấn công; ở đầu đàn thiên về đồ bảo vệ.',
  },
  {
    icon: '🪙',
    name: 'Golden Quack Box (Hộp Vàng)',
    tag: 'Hiếm (~15% tỉ lệ spawn)',
    color: 'border-[var(--color-ggd-gold)]/40 bg-[var(--color-ggd-gold)]/10 text-[var(--color-ggd-gold)]',
    description: 'Xuất hiện ngẫu nhiên giữa chặng (35% – 75% đường đua) trong race chính thức. Vịt nào nhanh tay chạm vào hộp vàng sẽ nhận ngay +1 Quack Point (QP) vào tài khoản mà không tốn ô chứa đồ!',
  },
] as const

export const WILD_ITEMS_LIST = WILD_ITEM_CATALOG

export const HAZARDS_LIST = [
  {
    id: 'ANCHOR',
    icon: '⚓',
    name: 'Mỏ neo',
    effect: 'Va phải làm giảm tốc nhẹ và chao đảo làn bơi trong thời gian ngắn.',
  },
  {
    id: 'WHIRLPOOL',
    icon: '🌀',
    name: 'Xoáy nước',
    effect: 'Hút nhẹ và làm giảm tốc vừa phải, khiến vịt lắc lư mạnh.',
  },
  {
    id: 'ICE_PATCH',
    icon: '🧊',
    name: 'Tảng băng',
    effect: 'Mặt băng trơn trượt làm vịt mất thăng bằng và khó giữ làn bơi ổn định.',
  },
  {
    id: 'STICKY_GOO',
    icon: '🟢',
    name: 'Keo dính',
    effect: 'Vũng keo cản trở làm chậm tốc độ bơi rõ rệt nhất trong các loại bẫy.',
  },
] as const

export const RACE_ACTION_TIPS = [
  {
    icon: '🎒',
    title: 'Wild Slot (Ô chứa đồ nhặt)',
    detail: 'Mỗi vịt chỉ có 1 ô Wild Slot. Item loại "Tức thì" (Instant) kích hoạt ngay khi chạm hộp. Item loại "Giữ slot" (Held) sẽ được cất vào túi để dùng sau.',
  },
  {
    icon: '🔴',
    title: 'Tự bấm nút "USE NOW" khi xem Live',
    detail: 'Khi đang theo dõi race trực tiếp trên web, bạn có thể tự bấm nút "USE NOW" để tung món đồ đang giữ đúng thời cơ hiểm hóc nhất nhằm xoay chuyển cục diện!',
  },
  {
    icon: '🤖',
    title: 'Auto-use thông minh (Tự động kích hoạt)',
    detail: 'Nếu bạn không trực tiếp bấm hoặc không online, vịt có AI tự động tính toán thời cơ hoàn hảo để tung chiêu (hoặc tự động dùng hết item trước khi về đích). Mọi item mang theo đều được sử dụng.',
  },
  {
    icon: '🛡️',
    title: 'Bảo vệ sau va chạm & Khắc chế đòn đánh',
    detail: 'Sau khi trúng đòn tấn công, vịt có 1 giây miễn nhiễm để không bị dồn sát thương liên tiếp. Rocket bị chặn bởi Bubble Shield và giảm sát thương bởi Shock Absorber; Chuối bị né bởi Feather.',
  },
] as const

export const SCORING_SYSTEM = [
  {
    icon: '🏅',
    title: 'Championship Points (BXH Vô Địch)',
    badge: 'Đường đua danh giá',
    detail: 'Điểm tích lũy cho danh hiệu Vô Địch Mùa Giải: Với N người tham gia, điểm = N − Hạng + 1 (về nhất nhận N điểm, về bét nhận 1 điểm). Sau 12 tuần, người đứng đầu BXH sẽ đăng quang ngôi vị Golden Duck!',
  },
  {
    icon: '👑',
    title: 'Vua Ao (King of the Pond)',
    badge: 'Ngai vàng ao vịt',
    detail: 'Người về nhất đường đua raw sẽ lên ngôi Vua Ao. Ở race kế tiếp, nếu Vua Ao giữ được vị trí trong Top 3 thì sẽ bảo vệ thành công vương miện và tăng chuỗi thắng (+1 Streak). Nếu rớt khỏi Top 3, ngôi vương thuộc về người về nhất mới!',
  },
  {
    icon: '🔮',
    title: 'Dự Đoán & Điểm Tiên Tri (Prediction Points)',
    badge: 'Bắt bài đối thủ',
    detail: 'Mỗi tuần bạn gửi 1 dự đoán bí mật chọn 1 vịt khác. Nếu người đó cán đích trong 2 vị trí cuối cùng trên đường đua (Raw Bottom 2, trước Chaos), bạn nhận +1 🔮 Prediction Point để leo BXH Tiên Tri cuối mùa.',
  },
  {
    icon: '🪙',
    title: 'Quack Points (QP) & Tiệm Thời Trang',
    badge: 'Tiền tệ & Làm đẹp',
    detail: 'Kiếm QP để mở Trứng Bí Ẩn (Mystery Egg - 3 QP) hoặc mua trang phục tại Shop: Thắng race (+5 QP), Đoán trúng người bị Chaos làm dzịt (+2 QP hoặc +1 QP), Tuần Hoàn Hảo vừa thắng vừa đoán trúng (+1 QP bonus), và Nhặt Hộp Vàng (+1 QP). Trang phục 100% là visual làm đẹp, không buff chỉ số đua.',
  },
] as const

export const FAQ_ITEMS = [
  {
    q: 'Dự đoán (Prediction) tính theo kết quả trước hay sau khi áp dụng Chaos?',
    a: '🔮 Prediction Points (điểm leo BXH Tiên Tri) tính theo 2 người về cuối cùng trên đường đua thực tế (Raw Bottom 2, trước Chaos). Riêng tiền thưởng 🪙 Quack Points (QP) cho dự đoán sẽ thưởng khi bạn đoán trúng người thực sự bị lá Chaos xử thua tuần đó.',
  },
  {
    q: 'Khiên (Shield) có cứu tôi nếu tôi về nhất ở tuần bài Reverse (Đảo ngược) không?',
    a: 'CÓ! Miễn là bạn có bật Khiên trước race và rơi vào danh sách thua của lá bài Chaos tuần đó (ở tuần Reverse là Top 2), Khiên sẽ kích hoạt và bạn hoàn toàn không bị nhận Sẹo.',
  },
  {
    q: 'Nếu tôi bật Khiên nhưng tuần đó tôi bơi an toàn không bị thua, Khiên có mất không?',
    a: 'CÓ! Khiên là vật phẩm tiêu hao 1 lần — khi bạn đã bấm xác nhận sử dụng cho race tuần đó, Khiên sẽ được dùng và trừ đi 1 sau trận đấu, bất kể bạn có gặp nguy hiểm hay không.',
  },
  {
    q: 'Tôi không online lúc race diễn ra thì có dùng được item không?',
    a: 'CÓ! Cả 2 item Loadout đã chọn và bất kỳ Wild Item nào nhặt được trên đường đua đều có cơ chế Auto-use thông minh. Vịt sẽ tự động tung chiêu đúng thời điểm hoặc ép dùng hết trước vạch đích.',
  },
  {
    q: 'Các trang phục, nón, áo mua bằng QP có giúp vịt bơi nhanh hơn không?',
    a: 'KHÔNG! Tất cả vật phẩm thời trang và hiệu ứng chỉ mang tính chất làm đẹp và thể hiện cá tính, hoàn toàn không làm thay đổi tốc độ hay cơ chế vật lý của đường đua.',
  },
] as const

export const RULES_NAV = [
  { id: 'quick-start', label: '⚡ 30s Hiểu luật' },
  { id: 'chaos-cards', label: '🃏 7 Lá bài Chaos' },
  { id: 'scar-shield', label: '🛡️ Sẹo & Khiên' },
  { id: 'loadout', label: '🎒 Chọn đồ Loadout' },
  { id: 'track-wild', label: '🏁 Đường đua & Wild Item' },
  { id: 'standings-qp', label: '🏆 Điểm, Vua Ao & QP' },
  { id: 'faq', label: '❓ Hỏi đáp & Mẹo' },
] as const
