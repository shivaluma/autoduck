//! `WILD_ITEM_CATALOG` (`packages/race-core/src/pickups/catalog.ts`, S3.15),
//! verbatim and in declaration order: `rollWildItem` filters this table and
//! indexes the result with the loot RNG, so the order is part of the replay
//! contract.

use race_protocol::ids::WildItemId;

/// `WildItemCategory`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum WildItemCategory {
    Attack,
    Defense,
    Mobility,
    Utility,
}

impl WildItemCategory {
    /// The TS literal.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Attack => "ATTACK",
            Self::Defense => "DEFENSE",
            Self::Mobility => "MOBILITY",
            Self::Utility => "UTILITY",
        }
    }
}

/// `WildItemBehavior`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum WildItemBehavior {
    Instant,
    Held,
}

impl WildItemBehavior {
    /// The TS literal.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Instant => "INSTANT",
            Self::Held => "HELD",
        }
    }
}

/// `WildItemDefinition`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WildItemDefinition {
    pub id: WildItemId,
    pub display_name: &'static str,
    pub icon: &'static str,
    pub category: WildItemCategory,
    pub behavior: WildItemBehavior,
    pub description: &'static str,
}

/// `WILD_ITEM_CATALOG` (`pickups/catalog.ts:15-24`), in TS order.
pub const WILD_ITEM_CATALOG: [WildItemDefinition; 8] = [
    WildItemDefinition {
        id: WildItemId::MiniNitro,
        display_name: "Mini Nitro",
        icon: "⚡",
        category: WildItemCategory::Mobility,
        behavior: WildItemBehavior::Instant,
        description: "Bứt tốc tức thì +9% tốc độ trong 1.15 giây.",
    },
    WildItemDefinition {
        id: WildItemId::Tailwind,
        display_name: "Tailwind",
        icon: "🌊",
        category: WildItemCategory::Utility,
        behavior: WildItemBehavior::Instant,
        description: "Thuận gió đẩy thuyền: +7% tốc độ và bơi ổn định giữ làn trong 1.9 giây.",
    },
    WildItemDefinition {
        id: WildItemId::MiniBubble,
        display_name: "Mini Bubble",
        icon: "🫧",
        category: WildItemCategory::Defense,
        behavior: WildItemBehavior::Held,
        description: "Bong bóng phòng hộ cầm tay (6s): chặn 1 đòn tấn công hoặc bẫy rồi nhận +12% trong 1.2s; hết hạn mà chưa dùng sẽ hóa luồng đẩy +13% trong 1.8s.",
    },
    WildItemDefinition {
        id: WildItemId::MiniRocket,
        display_name: "Mini Rocket",
        icon: "🚀",
        category: WildItemCategory::Attack,
        behavior: WildItemBehavior::Held,
        description: "Tên lửa mini cắt 50% thời gian boost còn lại, hãm tốc còn 25% trong 0.55s rồi 65% trong 0.45s. Trúng vịt Tốc độ sẽ cướp đà +20% trong 1.2s.",
    },
    WildItemDefinition {
        id: WildItemId::Banana,
        display_name: "Banana",
        icon: "🍌",
        category: WildItemCategory::Attack,
        behavior: WildItemBehavior::Held,
        description: "Ném bẫy chuối (lệch tối đa 0.18 làn, 8s): đối thủ đạp phải trượt lệch làn, hãm còn 22% trong 0.6s rồi 60% trong 0.5s. Trúng vịt Tốc độ sẽ cướp đà.",
    },
    WildItemDefinition {
        id: WildItemId::QuackHorn,
        display_name: "Quack Horn",
        icon: "🔊",
        category: WildItemCategory::Utility,
        behavior: WildItemBehavior::Held,
        description: "Thổi còi về một bên, húc dạt các vịt phía đó, phá boost (trừ Nitro) và Câm Lặng 0.7s; cướp đà từ 1 vịt Tốc độ. Bong bóng đang bật chặn được còi.",
    },
    WildItemDefinition {
        id: WildItemId::Feather,
        display_name: "Feather Hop",
        icon: "🪽",
        category: WildItemCategory::Defense,
        behavior: WildItemBehavior::Held,
        description: "Lông Vũ nhảy né (5.0s): né bẫy Chuối hoặc chướng ngại vật kế tiếp rồi nhận +12% trong 1.2s; hết hạn mà chưa dùng sẽ hóa luồng lướt +8% trong 1.2s.",
    },
    WildItemDefinition {
        id: WildItemId::SlipstreamMagnet,
        display_name: "Slipstream Magnet",
        icon: "🧲",
        category: WildItemCategory::Mobility,
        behavior: WildItemBehavior::Instant,
        description: "Nam châm bám luồng hút đối thủ gần nhất phía trước, tăng +12% tốc độ trong 1.6 giây.",
    },
];

/// `getWildItem(itemId)` (`pickups/catalog.ts:28-32`). Every [`WildItemId`]
/// is in the catalog, so the TS `Unknown Wild Item` throw cannot happen.
#[must_use]
pub fn get_wild_item(item_id: WildItemId) -> &'static WildItemDefinition {
    WILD_ITEM_CATALOG
        .iter()
        .find(|item| item.id == item_id)
        .expect("every WildItemId is in WILD_ITEM_CATALOG")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_covers_every_id_once() {
        for (index, item) in WILD_ITEM_CATALOG.iter().enumerate() {
            assert_eq!(
                WILD_ITEM_CATALOG
                    .iter()
                    .position(|other| other.id == item.id),
                Some(index)
            );
            assert_eq!(get_wild_item(item.id).id, item.id);
        }
    }
}
