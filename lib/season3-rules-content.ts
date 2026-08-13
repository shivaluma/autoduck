import { RACE_ITEM_CATALOG } from '@/packages/race-core/src/items/catalog'
import { WILD_ITEM_CATALOG } from '@/packages/race-core/src/pickups/catalog'

export const SEASON3_RULES_META = {
  title: 'Thể lệ Season 3',
  subtitle: 'Đua Dzịt — luật chơi, Chaos, item và mọi thứ bạn cần biết trước khi bơi.',
  weeks: 12,
}

export const SEASON3_OVERVIEW = {
  headline: 'Season 3 là gì?',
  paragraphs: [
    'Mỗi tuần, bầy vịt chạy một race deterministic trên server. Kết quả raw (thứ hạng về đích) được áp dụng lên một lá Chaos — quyết định ai bị làm dzịt tuần đó.',
    'Bạn chuẩn bị trước race: chọn loadout 2 item, quyết định có dùng Shield không, và gửi prediction bí mật. Trong race, item loadout và item nhặt trên track đều tự kích hoạt (auto-use); bạn có thể can thiệp thủ công Wild Item khi race đang live.',
    'Prediction Points (🔮) dùng cho meta season và phần thưởng. Championship Points dùng để chọn Golden Duck cuối season — prediction không ảnh hưởng BXH vô địch.',
  ],
}

export const WEEK_FLOW = [
  {
    step: '01',
    title: 'Prep mở (open)',
    body: 'Chaos tuần được reveal. Bạn khóa loadout (2 item / 3 Prep Credits), xác nhận Shield nếu muốn, và gửi prediction. Host có thể đánh dấu ai nghỉ tuần — người nghỉ không cần prep.',
  },
  {
    step: '02',
    title: 'Prep khóa (locked)',
    body: 'Host khóa prep và bắt đầu race chính thức (hoặc test race không ảnh hưởng điểm). Loadout và Chaos được ghi vào config bất biến; seed được commit.',
  },
  {
    step: '03',
    title: 'Race live (running)',
    body: 'Race chạy tự động trên server. Viewer xem live/replay. Người có secret link có thể bấm USE NOW cho Wild Item đang giữ — server xử lý trên tick kế tiếp.',
  },
  {
    step: '04',
    title: 'Resolve (resolved)',
    body: 'Hệ thống áp Chaos lên BXH raw, trao Scar/Shield, cộng prediction, cập nhật King, viết Duck News và cộng Championship Points.',
  },
] as const

export const STANDING_SYSTEM = [
  {
    icon: '🏅',
    label: 'Championship Points',
    detail: 'Mỗi race: điểm = số người − hạng + 1. Ví dụ 8 người, hạng 1 nhận 8 điểm, hạng 8 nhận 1 điểm. Cuối season, Golden Duck = ai có Championship Points cao nhất (hòa thì xét số race thắng).',
  },
  {
    icon: '🔮',
    label: 'Prediction Points',
    detail: '+1 🔮 nếu bạn đoán đúng một người nằm trong raw Bottom 2 (trước Chaos). Chaos và Shield không đổi điều kiện prediction.',
  },
  {
    icon: '🩹',
    label: 'Scar',
    detail: 'Mỗi lần bị làm dzịt (sau Chaos, không có Shield) nhận +1 Scar. 2 Scar → tự đổi thành 1 Shield.',
  },
  {
    icon: '🛡️',
    label: 'Shield',
    detail: 'Trước race, bạn xác nhận dùng Shield. Nếu tuần đó bạn bị Chaos làm dzịt: Shield chặn Scar nhưng bị tiêu hao — kể cả khi cuối cùng không bị làm dzịt.',
  },
  {
    icon: '👑',
    label: 'King of the Pond',
    detail: 'Vịt đang giữ ngôi King nếu về Top 3 raw thì giữ ngôi và +1 streak. Không giữ được Top 3 → người về nhất raw lên ngôi, streak reset về 1.',
  },
] as const

export const CHAOS_RULES = [
  {
    id: 'NORMAL',
    icon: '🏁',
    label: 'NORMAL',
    rule: 'Bottom 2 raw bị làm dzịt.',
    detail: 'Luật gốc. Hai người về chậm nhất theo BXH race là nạn nhân.',
  },
  {
    id: 'REVERSE',
    icon: '🔄',
    label: 'REVERSE',
    rule: 'Đảo BXH: Top 2 raw bị làm dzịt.',
    detail: 'Thứ hạng race bị lật ngược. Người về nhất và nhì trên bảng raw trở thành nhóm thua.',
  },
  {
    id: 'DUO',
    icon: '🤝',
    label: 'DUO',
    rule: 'Cặp có tổng hạng cao nhất bị làm dzịt.',
    detail: 'Trước race, mọi người được xếp ngẫu nhiên thành các cặp (cặp lẻ gộp vào cặp trước). Cặp có tổng rank lớn nhất thua; nếu hòa thì xét hạng tệ nhất trong cặp.',
  },
  {
    id: 'TRIPLE_ELIMINATION',
    icon: '💀',
    label: 'TRIPLE ELIMINATION',
    rule: 'Bottom 3 raw bị làm dzịt.',
    detail: 'Ba người về chậm nhất đều nhận Scar (trừ khi có Shield).',
  },
  {
    id: 'CUT_LINE',
    icon: '🚧',
    label: 'CUT LINE',
    rule: 'Top 50% an toàn. Phần còn lại bị làm dzịt.',
    detail: 'Với N người, ai xếp từ hạng ceil(N/2)+1 trở xuống đều thua.',
  },
  {
    id: 'CONSTRUCTORS',
    icon: '🏎️',
    label: 'CONSTRUCTORS',
    rule: 'Team có tổng hạng cao nhất bị làm dzịt.',
    detail: 'Chia đôi roster ngẫu nhiên thành 2 team. Team có tổng rank cao hơn thua; hòa tổng thì cả hai team đều thua.',
  },
  {
    id: 'BOUNTY_HUNT',
    icon: '🎯',
    label: 'BOUNTY HUNT',
    rule: 'Một Wanted được chọn ngẫu nhiên. Wanted phải lọt Top 50% raw.',
    detail: 'Nếu Wanted lọt Top 50%: Wanted an toàn, Bottom 2 raw bị làm dzịt. Nếu Wanted không lọt: Wanted và mọi người xếp sau Wanted đều bị làm dzịt.',
  },
] as const

export const LOADOUT_RULES = {
  credits: 3,
  slots: 2,
  majorLimit: 1,
  bullets: [
    'Chọn đúng 2 item, tổng chi phí = 3 Prep Credits.',
    'Tối đa 1 Major (2 Credits). Phần còn lại là Minor (1 Credit).',
    'Loadout khóa trước race; item tự dùng theo AI trong race (không bấm tay).',
    'Không chọn trùng item. Host có thể auto-fill loadout cho ai chưa khóa.',
  ],
  items: RACE_ITEM_CATALOG,
}

export const TRACK_PICKUPS = {
  boxes: [
    {
      icon: '❓',
      name: 'Quack Box',
      color: 'xanh',
      detail: 'Hộp ? xanh trên track. Nhặt được Wild Item hoặc hiệu ứng tức thì. Mỗi vịt tối đa 3 hộp thường trong một race; không nhặt thêm khi đang giữ Wild Item.',
    },
    {
      icon: '🪙',
      name: 'Golden Quack Box',
      color: 'vàng',
      detail: 'Tối đa 1 hộp vàng mỗi race chính thức (~15% spawn, giữa 35–75% đường đua). Nhặt được +1 Quack Point (QP) — không bị giới hạn slot Wild.',
    },
    {
      icon: '💜',
      name: 'Chaos Box',
      color: 'tím',
      detail: 'Kiến trúc đã có nhưng tắt trong race Normal chính thức. Chỉ xuất hiện ở Race Lab / chế độ thử nghiệm.',
    },
  ],
  zones: 'Bốn vùng spawn quanh 20%, 42%, 64% và 82% tiến độ track. Loot phụ thuộc vị trí BXH lúc nhặt (đuôi hơi thiên về tấn công/phòng thủ cân bằng).',
  wildSlot: 'Mỗi vịt có 1 Wild Slot. Item giữ (HELD) chiếm slot; item tức thì (INSTANT) kích hoạt ngay khi nhặt.',
}

export const WILD_ITEMS = WILD_ITEM_CATALOG

export const HAZARDS = [
  { id: 'ANCHOR', icon: '⚓', name: 'Mỏ neo', effect: 'Làm chậm nhẹ và lắc lane ~1.4 giây.' },
  { id: 'WHIRLPOOL', icon: '🌀', name: 'Xoáy nước', effect: 'Giảm tốc vừa phải, wobble mạnh hơn ~1.5 giây.' },
  { id: 'ICE_PATCH', icon: '🧊', name: 'Băng', effect: 'Trơn, khó giữ lane ~1.5 giây.' },
  { id: 'STICKY_GOO', icon: '🟢', name: 'Keo dính', effect: 'Chậm rõ nhất trong nhóm hazard ~1.3 giây.' },
] as const

export const RACE_PHYSICS_NOTES = [
  'Race deterministic: cùng seed + config → cùng kết quả. Không dùng Math.random() trong gameplay.',
  'Tăng tốc tích cực cap ~+25%; giảm tốc cap ~−45%. Slow chồng lấy giá trị mạnh nhất.',
  'Sau khi trúng item tấn công: 1 giây miễn nhiễm item. Trúng Rocket: mục tiêu được bảo vệ 2 giây khỏi Rocket khác.',
  'Rocket/Banana prep và wild có cơ chế tương tự nhưng cân bằng khác nhau. Banana gây knockback/slip trên track hơn là chỉ slow.',
  'Không có item nào dừng hẳn, đảo ngược, teleport hay xóa vịt khỏi race.',
  'Cosmetic chỉ là visual — không ảnh hưởng physics, loot, Chaos hay Shield.',
]

export const AUTO_USE_NOTES = [
  'Mọi item loadout và Wild Item đều auto-use trong race chính thức.',
  'Rocket: bắn vịt phía trước trong tầm (tầm rộng hơn gần vạch đích).',
  'Banana: thả bẫy nếu có vịt sát phía sau, hoặc thả trước vạch đích cuối race.',
  'Bubble: chặn đòn wild sắp tới hoặc leader đốt sớm gần đích.',
  'Horn: đẩy ngang khi đông vịt; bán kính lớn hơn gần finish.',
  'Feather: né banana/hazard nhỏ sắp tới hoặc đốt trước vạch đích.',
  'Người chơi thủ công có cửa sổ ngắn trước khi AI tự đốt item; gần đích AI ép dùng để không mang item về nhà.',
  'Sau khi nhặt box muộn, AI chạy thêm một pass để không ôm item tới finish.',
]

export const MANUAL_WILD_USE = [
  'Trên trang Season 3 khi race live: panel Wild Item hiện item đang giữ.',
  'Bấm USE NOW gửi lệnh idempotent; server validate token, race state, instance ID.',
  'Giới hạn ~5 lệnh/giây. Client không chọn target — server/AI quyết định.',
  'Dùng sai (không target, race xong, item đã auto) không tiêu hao item.',
  'Test race: panel vẫn hiện nhưng không mutate QP hay season state.',
]

export const COSMETICS_NOTES = [
  'Quack Points (QP) kiếm từ race chính thức: thắng race +5 QP; prediction đúng nhóm thua Chaos +1 hoặc +2; Perfect Week (thắng + đoán đúng) +1 bonus.',
  'Golden Box trên track: +1 QP (race chính thức).',
  'QP chỉ mua cosmetic / Mystery Egg — không buff race.',
  'Mystery Egg 3 QP, có pity tier. Duplicate refund 2 QP.',
]

export const GLOSSARY = [
  { term: 'Raw ranking', def: 'Thứ hạng về đích nguyên bản từ race engine, trước Chaos.' },
  { term: 'Bottom 2', def: 'Hai người xếp cuối raw — dùng cho prediction Normal.' },
  { term: 'Làm dzịt', def: 'Bị Chaos chọn là người thua → nhận Scar (nếu không Shield).' },
  { term: 'Prep Credits', def: 'Ngân sách 3 điểm để chọn 2 item loadout.' },
  { term: 'Wild Slot', def: 'Ô giữ tối đa 1 Wild Item nhặt trên track.' },
  { term: 'Deterministic', def: 'Cùng input → cùng output; replay và live sync được.' },
] as const

export const RULES_NAV = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'week-flow', label: 'Vòng tuần' },
  { id: 'standings', label: 'Điểm & huy hiệu' },
  { id: 'chaos', label: 'Chaos Cards' },
  { id: 'loadout', label: 'Loadout' },
  { id: 'track', label: 'Track & hộp' },
  { id: 'wild-items', label: 'Wild Items' },
  { id: 'hazards', label: 'Hazards' },
  { id: 'auto-use', label: 'Auto-use' },
  { id: 'manual', label: 'Dùng tay' },
  { id: 'physics', label: 'Luật race' },
  { id: 'cosmetics', label: 'QP & cosmetic' },
  { id: 'glossary', label: 'Thuật ngữ' },
] as const
