//! Race item catalog (D19: Rust is the single source; exported later to
//! `src/engine/generated/catalog.json`).
//!
//! Ported verbatim from `packages/race-core/src/items/catalog.ts` and
//! `items/classes.ts` (S3.15). Order matters: `selectAutoLoadout` filters
//! this table in declaration order and indexes the result with the RNG.
//! The meta-parity fixture (`tests/fixtures/meta-parity.json.gz`) carries the
//! TS table and `tests/meta_parity.rs` checks every field against it.

use race_protocol::ids::RaceItemId;

/// `ItemClass` (`items/classes.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ItemClass {
    Speed,
    Defense,
    Attack,
}

impl ItemClass {
    /// The TS literal.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Speed => "SPEED",
            Self::Defense => "DEFENSE",
            Self::Attack => "ATTACK",
        }
    }
}

/// `RaceItemDefinition.category`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ItemCategory {
    Major,
    Minor,
}

impl ItemCategory {
    /// The TS literal.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Major => "major",
            Self::Minor => "minor",
        }
    }
}

/// `RaceItemDefinition` (`items/catalog.ts:4-12`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RaceItemDefinition {
    pub id: RaceItemId,
    pub name: &'static str,
    pub icon: &'static str,
    /// Prep credits, `1 | 2`.
    pub cost: u8,
    pub category: ItemCategory,
    pub item_class: ItemClass,
    pub description: &'static str,
}

/// `RACE_ITEM_CATALOG`, in TS declaration order.
pub const RACE_ITEM_CATALOG: [RaceItemDefinition; 9] = [
    RaceItemDefinition {
        id: RaceItemId::Nitro,
        name: "Nitro",
        icon: "⚡",
        cost: 2,
        category: ItemCategory::Major,
        item_class: ItemClass::Speed,
        description: "Bình tăng tốc 3 giai đoạn (Đề pa → Đỉnh điểm +25% → Hạ nhiệt) trong 1.8s giúp xé gió vượt lên (1 lần/trận). Khắc chế Phòng thủ; bị Tấn công phá đà và cướp tốc.",
    },
    RaceItemDefinition {
        id: RaceItemId::DraftFin,
        name: "Draft Fin",
        icon: "🦈",
        cost: 1,
        category: ItemCategory::Minor,
        item_class: ItemClass::Speed,
        description: "Bám sát đuôi đối thủ phía trước trong 0.75s để đón luồng lướt gió tăng tốc +21% trong 1.6s (1 lần/trận).",
    },
    RaceItemDefinition {
        id: RaceItemId::PaddleBurst,
        name: "Paddle Burst",
        icon: "🛶",
        cost: 1,
        category: ItemCategory::Minor,
        item_class: ItemClass::Speed,
        description: "Quạt nước bứt tốc +15% trong 1.8s ở chặng cuối (từ 65% quãng đường) để lội ngược dòng (1 lần/trận).",
    },
    RaceItemDefinition {
        id: RaceItemId::BubbleShield,
        name: "Bubble Shield",
        icon: "🫧",
        cost: 2,
        category: ItemCategory::Major,
        item_class: ItemClass::Defense,
        description: "Bong bóng phản xạ: tự bung khi Tên Lửa/Chuối trang bị đầu tiên sắp trúng (trừ khi đang bị Câm Lặng) và chặn hoàn toàn; khi đang bật cũng vô hiệu Còi và đồ nhặt. Chặn thành công nhận Guard Surge +8% trong 1s. Cồng kềnh: chậm 0.5% khi chưa dùng.",
    },
    RaceItemDefinition {
        id: RaceItemId::Feather,
        name: "Feather",
        icon: "🪶",
        cost: 1,
        category: ItemCategory::Minor,
        item_class: ItemClass::Defense,
        description: FEATHER_DESCRIPTION,
    },
    RaceItemDefinition {
        id: RaceItemId::ShockAbsorber,
        name: "Shock Absorber",
        icon: "🦺",
        cost: 1,
        category: ItemCategory::Minor,
        item_class: ItemClass::Defense,
        description: "Áo giáp chống sốc (Nội tại): đỡ 1 đòn Tên Lửa (còn 40% tốc độ 0.3s rồi 80% 0.3s, vẫn mất boost) hoặc Còi (giảm 60% lực đẩy, không bị Câm Lặng); hồi xong nhận Guard Surge +6% trong 0.8s. Không giữ được Nitro khỏi bị cướp đà.",
    },
    RaceItemDefinition {
        id: RaceItemId::HomingRocket,
        name: "Homing Rocket",
        icon: "🚀",
        cost: 2,
        category: ItemCategory::Major,
        item_class: ItemClass::Attack,
        description: "Bắn tên lửa tầm nhiệt nhắm đối thủ phía trước, triệt tiêu tăng tốc và hãm tốc còn 12% trong 0.95s rồi 50% trong 0.65s (1 lần/trận). Trúng vịt Tốc độ (đang boost hoặc còn Nitro) sẽ cướp đà +20% trong 2.3s.",
    },
    RaceItemDefinition {
        id: RaceItemId::Banana,
        name: "Banana",
        icon: "🍌",
        cost: 1,
        category: ItemCategory::Minor,
        item_class: ItemClass::Attack,
        description: "Ném vỏ chuối ra sau (lệch tối đa 0.22 làn sang bên để đón đúng đường bơi của kẻ bám đuôi, tồn tại 14s); đối thủ dẫm phải bị trượt văng làn, mất boost và hãm còn 15% trong 0.85s rồi 60% trong 0.7s. Trúng vịt Tốc độ sẽ cướp đà.",
    },
    RaceItemDefinition {
        id: RaceItemId::QuackHorn,
        name: "Quack Horn",
        icon: "🔊",
        cost: 1,
        category: ItemCategory::Minor,
        item_class: ItemClass::Attack,
        description: "Thổi còi định hướng về một bên (tầm 0.55 làn): húc dạt mọi đối thủ phía đó về cùng hướng — có thể đẩy họ vào vỏ chuối hay chướng ngại vật — phá mọi boost (kể cả Nitro) và Câm Lặng 0.5s; sau đó mục tiêu miễn câm lặng 2s. Cướp đà 1.5s từ 1 vịt Tốc độ trúng còi. Bong bóng đang bật và Lông vũ chặn được còi.",
    },
];

/// The Feather row's copy.
///
/// S3.15 (`ts-compat`, the TS catalog) promised a dodge of "Vỏ Chuối, Còi
/// Quack Horn hoặc chướng ngại vật", but the loadout Feather never dodges a
/// hazard: only the wild Feather Hop does (`items::interactions`). **F13
/// (S3.16):** the copy says what the code does.
const FEATHER_DESCRIPTION: &str = if crate::TS_COMPAT {
    "Lông vũ hộ thân (Nội tại): nhảy né 1 lần Vỏ Chuối, Còi Quack Horn hoặc chướng ngại vật (không chặn Tên Lửa), né xong nhận Guard Surge +15% trong 1.8s. Chưa dùng tới 88% quãng đường sẽ hóa luồng lướt +4% trong 1s."
} else {
    "Lông vũ hộ thân (Nội tại): nhảy né 1 lần Vỏ Chuối hoặc Còi Quack Horn (không chặn Tên Lửa hay chướng ngại vật), né xong nhận Guard Surge +15% trong 1.8s. Chưa dùng tới 88% quãng đường sẽ hóa luồng lướt +4% trong 1s."
};

/// `AUTO_LOADOUT_PRESETS` (`items/catalog.ts:26-30`).
pub const AUTO_LOADOUT_PRESETS: [[RaceItemId; 2]; 3] = [
    [RaceItemId::Nitro, RaceItemId::DraftFin],
    [RaceItemId::BubbleShield, RaceItemId::Feather],
    [RaceItemId::HomingRocket, RaceItemId::Banana],
];

/// `getRaceItem(itemId)`. The TS `find(...)!` cannot miss for a valid id,
/// and `RaceItemId` admits only valid ids.
///
/// # Panics
/// Never: every `RaceItemId` variant has a catalog row (checked by a test).
#[must_use]
pub fn get_race_item(item_id: RaceItemId) -> &'static RaceItemDefinition {
    RACE_ITEM_CATALOG
        .iter()
        .find(|item| item.id == item_id)
        .expect("every RaceItemId has a catalog row")
}

/// `ITEM_CLASS_BY_ID[itemId]` (`items/classes.ts:5-15`).
#[must_use]
pub fn item_class(item_id: RaceItemId) -> ItemClass {
    get_race_item(item_id).item_class
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_item_id_has_one_row_in_protocol_order() {
        assert_eq!(RACE_ITEM_CATALOG.len(), RaceItemId::ALL.len());
        for (row, &id) in RACE_ITEM_CATALOG.iter().zip(RaceItemId::ALL) {
            assert_eq!(row.id, id);
            assert_eq!(get_race_item(id).id, id);
        }
    }

    #[test]
    fn cost_matches_category() {
        for row in &RACE_ITEM_CATALOG {
            let expected = match row.category {
                ItemCategory::Major => 2,
                ItemCategory::Minor => 1,
            };
            assert_eq!(row.cost, expected, "{}", row.id);
        }
    }
}
