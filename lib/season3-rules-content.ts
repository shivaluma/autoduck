import { RACE_ITEM_CATALOG } from '@/packages/race-core/src/items/catalog'
import { WILD_ITEM_CATALOG } from '@/packages/race-core/src/pickups/catalog'

export const SEASON3_RULES_META = {
  title: 'Luật Chơi Season 3',
  subtitle: 'Cẩm nang toàn tập: Vòng tuần, lá bài Chaos, nghệ thuật phối đồ Loadout và bí kíp sinh tồn tại Ao Dzịt.',
  weeks: 12,
}

export const QUICK_START_STEPS = [
  {
    step: '01',
    icon: '🃏',
    title: 'Xem Chaos Tuần',
    body: 'Mỗi tuần giải đấu lật mở 1 lá bài Chaos, thay đổi hoàn toàn quy tắc ai là người "bị làm dzịt" (nhóm thua cuộc).',
  },
  {
    step: '02',
    icon: '🎒',
    title: 'Chuẩn Bị Ra Trận',
    body: 'Chọn 2 món Loadout (tổng 3 Credits), quyết định có bật Khiên cứu mạng hay không, và gửi 1 dự đoán bí mật.',
  },
  {
    step: '03',
    icon: '🏁',
    title: 'Theo Dõi Đua Vịt',
    body: 'Đường đua nước diễn ra tự động. Các chú dzịt tự động tung chiêu bằng trí tuệ nhân tạo (AI) thông minh và nhặt hộp quà tăng tốc.',
  },
  {
    step: '04',
    icon: '🏆',
    title: 'Nhận Điểm & Sắm Đồ',
    body: 'Áp dụng luật Chaos để xử thua/trao Sẹo, cộng điểm vô địch, thưởng Điểm Tiên Tri và Quack Points (QP) để sắm skin.',
  },
] as const

export const CHAOS_CARDS = [
  {
    id: 'NORMAL',
    icon: '🏁',
    name: 'NORMAL',
    headline: 'Luật truyền thống: 2 người về cuối cùng thua',
    summary: 'Hai vịt cán đích chậm nhất trên đường đua sẽ bị làm dzịt.',
    tip: 'Bơi ổn định, tránh rơi vào 2 vị trí bét bảng là an toàn tuyệt đối.',
  },
  {
    id: 'REVERSE',
    icon: '🔄',
    name: 'REVERSE',
    headline: 'Đảo ngược: 2 người về ĐẦU TIÊN thua',
    summary: 'Thứ hạng bị lật ngược hoàn toàn! Hai vịt về Nhất và Nhì trên đường đua sẽ trở thành nạn nhân bị làm dzịt.',
    tip: 'Tuần này bơi nhanh là tự hại mình — hãy chọn đồ kìm tốc hoặc nhường đường cho đối thủ!',
  },
  {
    id: 'DUO',
    icon: '🤝',
    name: 'DUO',
    headline: 'Ghép đôi sinh tử: Cặp có tổng thứ hạng tệ nhất cùng thua',
    summary: 'Trước race, hệ thống bốc thăm ngẫu nhiên thành từng cặp (nếu lẻ người sẽ có một nhóm 3). Cặp nào có tổng thứ hạng lớn nhất (chậm nhất) sẽ cùng dính đòn.',
    tip: 'Nếu đồng đội bơi chậm, hãy cố gắng về top thật cao để gánh tổng điểm cho cả cặp.',
  },
  {
    id: 'TRIPLE_ELIMINATION',
    icon: '💀',
    name: 'TRIPLE ELIMINATION',
    headline: 'Thanh trừng diện rộng: 3 người về cuối cùng thua',
    summary: 'Áp lực sinh tồn tăng cao khi cả 3 vịt về chậm nhất (Bottom 3) đều bị làm dzịt.',
    tip: 'Tranh chấp vị trí thứ 4 từ dưới lên sẽ cực kỳ nghẹt thở — một sai lầm nhỏ là trả giá ngay.',
  },
  {
    id: 'CUT_LINE',
    icon: '🚧',
    name: 'CUT LINE',
    headline: 'Nhát cắt 50%: Toàn bộ nửa dưới bảng xếp hạng cùng thua',
    summary: 'Chỉ Top 50% vịt về trước là an toàn. Tất cả những ai rơi vào nửa sau của đoàn đua đều bị xử thua.',
    tip: 'Ranh giới sống còn nằm ngay giữa đoàn — hãy dồn lực bứt phá vào nửa trên!',
  },
  {
    id: 'CONSTRUCTORS',
    icon: '🏎️',
    name: 'CONSTRUCTORS',
    headline: 'Đại chiến 2 Đội: Toàn bộ đội có tổng hạng tệ hơn cùng thua',
    summary: 'Tất cả đấu thủ được chia ngẫu nhiên thành 2 đội. Đội có tổng thứ hạng lớn hơn (tệ hơn) sẽ thua cả đội. Nếu hòa điểm, cả 2 đội cùng dính phạt!',
    tip: 'Tinh thần đồng đội quyết định tất cả — mỗi bậc thứ hạng của bạn đều giúp cứu cả team.',
  },
  {
    id: 'BOUNTY_HUNT',
    icon: '🎯',
    name: 'BOUNTY HUNT',
    headline: 'Truy tìm Mục Tiêu (Wanted): Cả làng ngắm vào một người',
    summary: 'Một vịt ngẫu nhiên được chọn làm "Kẻ Bị Truy Nã" (Wanted). Nếu Wanted vào được Top 50%: Wanted an toàn, 2 người bét bảng thua. Nếu Wanted rớt khỏi Top 50%: Wanted và TẤT CẢ những ai về sau Wanted đều bị xử thua!',
    tip: 'Nếu bạn là Wanted, hãy bơi thục mạng vào Top 50! Nếu là người khác, cẩn thận đừng để Wanted kéo chìm theo.',
  },
] as const

export const SCAR_SHIELD_RULES = [
  {
    icon: '🩹',
    title: 'Sẹo (Scar) — Dấu ấn thất bại',
    points: [
      'Mỗi lần bạn rơi vào nhóm thua của lá bài Chaos tuần đó (mà không bật Khiên), bạn nhận +1 Sẹo.',
      'Sẹo là lời nhắc nhở cho lần "lên dĩa", nhưng cứ yên tâm — nỗi đau sẽ hóa thành sức mạnh bảo vệ!',
    ],
  },
  {
    icon: '🛡️',
    title: 'Khiên (Shield) — Lá chắn cứu mạng',
    points: [
      'Cứ tích lũy đủ 2 Sẹo, hệ thống sẽ tự động rèn thành 1 Khiên bảo vệ cho bạn.',
      'Cách dùng: Trước khi race diễn ra (ở bước Chuẩn Bị), bạn tick chọn kích hoạt Khiên.',
      'Cơ chế tiêu hao: Khi đã chọn dùng, Khiên LUÔN TIÊU HAO (-1 Khiên) sau race đó, bất kể bạn về đích ở vị trí nào.',
      'Cơ chế bảo vệ: Nếu tuần đó bạn rơi vào nhóm thua của Chaos, Khiên sẽ đỡ trọn vẹn và bạn KHÔNG bị nhận Sẹo (+0 Sẹo).',
      'Độc lập & công bằng: Khiên bảo vệ chính bạn và không đẩy hình phạt sang bất kỳ người chơi nào khác.',
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
      counters: 'Bứt phá vượt lên hàng phòng thủ 🛡️',
      items: 'Nitro, Draft Fin, Paddle Burst',
    },
    {
      type: 'DEFENSE',
      icon: '🛡️',
      name: 'Phòng thủ (Defense)',
      counters: 'Chặn đứng và hóa giải đòn tấn công 💥',
      items: 'Bubble Shield, Feather, Shock Absorber',
    },
    {
      type: 'ATTACK',
      icon: '💥',
      name: 'Tấn công (Attack)',
      counters: 'Phá đợt tăng tốc và làm chậm Tốc độ ⚡',
      items: 'Homing Rocket, Banana, Quack Horn',
    },
  ],
  items: [
    {
      id: 'NITRO',
      name: 'Nitro',
      icon: '⚡',
      cost: 2,
      category: 'major' as const,
      itemClass: 'SPEED' as const,
      description: 'Tăng tốc mạnh mẽ (+18% tốc độ) trong thời gian ngắn để bứt phá dẫn đầu.',
    },
    {
      id: 'BUBBLE_SHIELD',
      name: 'Bubble Shield',
      icon: '🫧',
      cost: 2,
      category: 'major' as const,
      itemClass: 'DEFENSE' as const,
      description: 'Bong bóng bảo vệ, chặn trọn vẹn 1 đòn tấn công (Tên lửa, Chuối hoặc đòn đánh).',
    },
    {
      id: 'HOMING_ROCKET',
      name: 'Homing Rocket',
      icon: '🚀',
      cost: 2,
      category: 'major' as const,
      itemClass: 'ATTACK' as const,
      description: 'Tên lửa tầm nhiệt nhắm vào đối thủ phía trước: làm chậm mạnh và dập tắt ngay đợt tăng tốc.',
    },
    {
      id: 'DRAFT_FIN',
      name: 'Draft Fin',
      icon: '🦈',
      cost: 1,
      category: 'minor' as const,
      itemClass: 'SPEED' as const,
      description: 'Bám luồng nước: khi bơi sát đuôi vịt phía trước sẽ nhận cú hích tăng tốc (1 lần/race).',
    },
    {
      id: 'PADDLE_BURST',
      name: 'Paddle Burst',
      icon: '🛶',
      cost: 1,
      category: 'minor' as const,
      itemClass: 'SPEED' as const,
      description: 'Lội ngược dòng: kích hoạt tăng tốc ở nửa sau đường đua nếu đang nằm trong nhóm dưới (1 lần/race).',
    },
    {
      id: 'FEATHER',
      name: 'Feather',
      icon: '🪶',
      cost: 1,
      category: 'minor' as const,
      itemClass: 'DEFENSE' as const,
      description: 'Lông vũ hộ thể: tự động né 1 bẫy Chuối hoặc chướng ngại vật trên mặt nước.',
    },
    {
      id: 'SHOCK_ABSORBER',
      name: 'Shock Absorber',
      icon: '🦺',
      cost: 1,
      category: 'minor' as const,
      itemClass: 'DEFENSE' as const,
      description: 'Giảm xóc: giảm 50% hiệu ứng làm chậm từ đòn Tên lửa hoặc Tiếng còi đầu tiên dính phải.',
    },
    {
      id: 'BANANA',
      name: 'Banana',
      icon: '🍌',
      cost: 1,
      category: 'minor' as const,
      itemClass: 'ATTACK' as const,
      description: 'Thả vỏ chuối lại phía sau: khiến vịt đạp phải bị trượt bánh và mất đà.',
    },
    {
      id: 'QUACK_HORN',
      name: 'Quack Horn',
      icon: '🔊',
      cost: 1,
      category: 'minor' as const,
      itemClass: 'ATTACK' as const,
      description: 'Bấm còi inh ỏi: đẩy dạt các chú vịt đang bơi sát cạnh sang hai bên.',
    },
  ],
}

export const TRACK_BOXES = [
  {
    icon: '❓',
    name: 'Hộp Quà (Quack Box)',
    tag: 'Tối đa 3 hộp / vịt',
    color: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
    description: 'Xuất hiện dọc 4 cụm trên đường đua. Mở ra các món đồ Wild Item ngẫu nhiên (tăng tốc, tên lửa mini, khiên mini, bẫy chuối...). Vịt bơi phía sau dễ nhận đồ tăng tốc/tấn công; vịt dẫn đầu dễ nhận đồ phòng thủ.',
  },
  {
    icon: '🪙',
    name: 'Hộp Vàng (Golden Box)',
    tag: 'Hiếm (xuất hiện ngẫu nhiên)',
    color: 'border-[var(--color-ggd-gold)]/40 bg-[var(--color-ggd-gold)]/10 text-[var(--color-ggd-gold)]',
    description: 'Hộp vàng cực hiếm xuất hiện giữa chặng đua. Chú vịt nào nhanh chân chạm vào hộp vàng đầu tiên sẽ nhận ngay +1 Quack Point (QP) vào tài khoản!',
  },
] as const

export const WILD_ITEMS_LIST = [
  {
    id: 'MINI_NITRO',
    displayName: 'Mini Nitro',
    icon: '⚡',
    typeText: 'Kích hoạt ngay',
    description: 'Tăng tốc nhẹ trong chốc lát để vượt lên đối thủ.',
  },
  {
    id: 'TAILWIND',
    displayName: 'Tailwind (Thuận Gió)',
    icon: '🌊',
    typeText: 'Kích hoạt ngay',
    description: 'Cơn gió xuôi đẩy vịt lướt êm và ổn định về phía trước.',
  },
  {
    id: 'SLIPSTREAM_MAGNET',
    displayName: 'Slipstream Magnet',
    icon: '🧲',
    typeText: 'Kích hoạt ngay',
    description: 'Nam châm hút vịt bám sát luồng bơi của đối thủ gần nhất phía trước.',
  },
  {
    id: 'MINI_BUBBLE',
    displayName: 'Mini Bubble',
    icon: '🫧',
    typeText: 'Tự dùng khi có biến',
    description: 'Tạo bong bóng bảo vệ chặn 1 đòn tấn công sắp tới.',
  },
  {
    id: 'MINI_ROCKET',
    displayName: 'Mini Rocket',
    icon: '🚀',
    typeText: 'Tự dùng khi có mục tiêu',
    description: 'Bắn tên lửa mini làm chậm vịt đang bơi phía trước.',
  },
  {
    id: 'BANANA',
    displayName: 'Banana (Vỏ Chuối)',
    icon: '🍌',
    typeText: 'Tự đặt bẫy',
    description: 'Thả bẫy chuối phía sau khiến đối thủ đuổi theo trượt ngã.',
  },
  {
    id: 'QUACK_HORN',
    displayName: 'Quack Horn (Còi Vịt)',
    icon: '🔊',
    typeText: 'Tự dùng khi va chạm',
    description: 'Thổi còi cực mạnh đẩy văng các vịt bơi chen lấn xung quanh.',
  },
  {
    id: 'FEATHER',
    displayName: 'Feather Hop',
    icon: '🪽',
    typeText: 'Tự nhảy né bẫy',
    description: 'Nhảy nhẹ trên mặt nước để né bẫy chuối hoặc chướng ngại vật kế tiếp.',
  },
] as const

export const HAZARDS_LIST = [
  {
    id: 'ANCHOR',
    icon: '⚓',
    name: 'Mỏ neo',
    effect: 'Va phải làm giảm tốc nhẹ và chao đảo đường bơi.',
  },
  {
    id: 'WHIRLPOOL',
    icon: '🌀',
    name: 'Xoáy nước',
    effect: 'Xoáy nước hút nhẹ và làm chậm tốc độ bơi.',
  },
  {
    id: 'ICE_PATCH',
    icon: '🧊',
    name: 'Tảng băng',
    effect: 'Mặt băng trơn trượt làm vịt mất thăng bằng và khó giữ hướng.',
  },
  {
    id: 'STICKY_GOO',
    icon: '🟢',
    name: 'Vũng keo',
    effect: 'Vũng keo dính cản trở khiến vịt bị chậm rõ rệt nhất.',
  },
] as const

export const RACE_ACTION_TIPS = [
  {
    icon: '🤖',
    title: 'Vịt Tự Động Dùng Đồ Thông Minh (Auto-use)',
    detail: 'Bạn không cần phải canh nút bấm khi xem đua. Vịt được trang bị AI thông minh tự nhận biết thời cơ tốt nhất để dùng item mang theo lẫn đồ nhặt được trên đường.',
  },
  {
    icon: '🛡️',
    title: 'Miễn Nhiễm Tạm Thời Sau Va Chạm',
    detail: 'Sau khi trúng một đòn tấn công, vịt có khoảng thời gian miễn nhiễm ngắn để không bị dồn sát thương liên tiếp.',
  },
  {
    icon: '⚖️',
    title: 'Khắc Chế Tự Nhiên Giữa Các Hệ Đồ',
    detail: 'Tên lửa phá đợt tăng tốc Nitro; Bong bóng Shield chặn Tên lửa; Lông vũ Feather giúp né bẫy Chuối. Chọn đồ thông minh trước trận sẽ tạo lợi thế lớn!',
  },
  {
    icon: '🌊',
    title: 'Đường Bơi Luôn Có Lối Thoát',
    detail: 'Các chướng ngại vật xuất hiện ngẫu nhiên luôn chừa làn nước an toàn. Vịt có thể tự khéo léo bơi tránh nếu không bị chen lấn.',
  },
] as const

export const SCORING_SYSTEM = [
  {
    icon: '🏅',
    title: 'BXH Vô Địch (Championship Points)',
    badge: 'Đường đua danh giá',
    detail: 'Điểm tích lũy theo thứ hạng về đích: Với N vịt tham gia, người về Nhất nhận N điểm, về Nhì nhận N−1 điểm... về bét nhận 1 điểm. Sau 12 tuần, người có tổng điểm cao nhất sẽ nâng Cúp Vô Địch Golden Duck!',
  },
  {
    icon: '👑',
    title: 'Vua Ao (King of the Pond)',
    badge: 'Ngai vàng ao vịt',
    detail: 'Người về Nhất trên đường đua sẽ đăng quang Vua Ao. Ở race kế tiếp, nếu Vua Ao giữ được vị trí trong Top 3 thì bảo vệ thành công vương miện và tăng Chuỗi Thống Trị (+1). Nếu rớt khỏi Top 3, ngôi vương thuộc về người về Nhất mới!',
  },
  {
    icon: '🔮',
    title: 'Dự Đoán & Điểm Tiên Tri (Prediction Points)',
    badge: 'Bắt bài đối thủ',
    detail: 'Mỗi tuần bạn chọn 1 chú vịt mà bạn dự đoán sẽ về chậm nhất. Nếu người đó cán đích trong 2 vị trí cuối cùng trên đường đua (Raw Bottom 2), bạn nhận +1 🔮 Điểm Tiên Tri để tranh cúp Nhà Tiên Tri cuối mùa.',
  },
  {
    icon: '🪙',
    title: 'Quack Points (QP) & Tiệm Thời Trang',
    badge: 'Tiền tệ & Làm đẹp',
    detail: 'Kiếm QP để sắm trang phục hoặc mở Trứng Bí Ẩn (3 QP): Thắng race (+5 QP), Đoán trúng người bị Chaos xử thua (+2 QP hoặc +1 QP), Tuần Hoàn Hảo vừa thắng vừa đoán trúng (+1 QP bonus), và Nhặt Hộp Vàng (+1 QP). Toàn bộ trang phục là 100% làm đẹp, không buff chỉ số đua.',
  },
] as const

export const FAQ_ITEMS = [
  {
    q: 'Dự đoán (Prediction) tính theo kết quả trước hay sau khi áp dụng Chaos?',
    a: '🔮 Điểm Tiên Tri (leo BXH Tiên Tri) tính theo 2 người về cuối cùng trên đường đua thực tế (Raw Bottom 2). Riêng tiền thưởng 🪙 Quack Points (QP) sẽ được trao khi bạn đoán trúng người thực sự bị lá bài Chaos xử thua tuần đó.',
  },
  {
    q: 'Khiên (Shield) có cứu tôi nếu tôi về nhất ở tuần bài Reverse (Đảo ngược) không?',
    a: 'CÓ! Miễn là bạn có bật Khiên trước race và rơi vào danh sách thua của lá bài Chaos tuần đó (ở tuần Reverse là Top 2), Khiên sẽ kích hoạt bảo vệ và bạn hoàn toàn không bị nhận Sẹo.',
  },
  {
    q: 'Nếu tôi bật Khiên nhưng tuần đó tôi bơi an toàn không bị thua, Khiên có mất không?',
    a: 'CÓ! Khiên là vật phẩm tiêu hao 1 lần — khi bạn đã chọn sử dụng cho race tuần đó, Khiên sẽ được tiêu hao (-1) sau trận đấu, bất kể bạn có gặp nguy hiểm hay không.',
  },
  {
    q: 'Tôi không online lúc race diễn ra thì vịt có thi đấu và dùng item được không?',
    a: 'HOÀN TOÀN ĐƯỢC! Các món đồ Loadout bạn đã chọn và bất kỳ vật phẩm nào nhặt được trên đường đua đều có cơ chế tự động kích hoạt thông minh (Auto-use). Bạn chỉ cần chuẩn bị đồ trước giờ đua.',
  },
  {
    q: 'Các trang phục, nón, áo mua bằng QP có giúp vịt bơi nhanh hơn không?',
    a: 'KHÔNG! Tất cả vật phẩm thời trang và hiệu ứng chỉ mang tính chất làm đẹp và thể hiện cá tính, hoàn toàn không làm thay đổi tốc độ hay cơ chế vật lý của cuộc đua.',
  },
] as const

export const RULES_NAV = [
  { id: 'quick-start', label: '⚡ 30s Hiểu luật' },
  { id: 'chaos-cards', label: '🃏 7 Lá bài Chaos' },
  { id: 'scar-shield', label: '🛡️ Sẹo & Khiên' },
  { id: 'loadout', label: '🎒 Phối đồ Loadout' },
  { id: 'track-wild', label: '🏁 Đường đua & Hộp quà' },
  { id: 'standings-qp', label: '🏆 Điểm, Vua Ao & QP' },
  { id: 'faq', label: '❓ Hỏi đáp & Mẹo' },
] as const

