-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "googleId" TEXT,
    "avatarUrl" TEXT,
    "scars" INTEGER NOT NULL DEFAULT 0,
    "shields" INTEGER NOT NULL DEFAULT 0,
    "shieldsUsed" INTEGER NOT NULL DEFAULT 0,
    "totalKhaos" INTEGER NOT NULL DEFAULT 0,
    "cleanStreak" INTEGER NOT NULL DEFAULT 0,
    "isBoss" BOOLEAN NOT NULL DEFAULT false,
    "bossSince" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Race" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "videoUrl" TEXT,
    "finalVerdict" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "engineState" TEXT NOT NULL DEFAULT 'CREATED',
    "protocolVersion" TEXT,
    "engineVersion" TEXT,
    "balanceVersion" TEXT,
    "trackVersion" TEXT,
    "seedCommit" TEXT,
    "raceSeed" TEXT,
    "engineConfigJson" TEXT,
    "resultDigest" TEXT,
    "liveSnapshotJson" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RaceReplayTrack" (
    "raceId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "format" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fidelity" TEXT NOT NULL,
    "engineImpl" TEXT NOT NULL,
    "engineCommit" TEXT,
    "engineBuild" TEXT,
    "engineVersion" TEXT NOT NULL,
    "balanceVersion" TEXT NOT NULL,
    "trackVersion" TEXT NOT NULL,
    "trackGeometry" TEXT,
    "tickRate" INTEGER NOT NULL,
    "tickCount" INTEGER NOT NULL,
    "stride" INTEGER NOT NULL DEFAULT 1,
    "reproducedDigest" TEXT,
    "byteSha256" TEXT,
    "bytes" BLOB,
    "statsJson" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RaceReplayTrack_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RaceEngineEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "raceId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "timestampWithinRaceMs" REAL NOT NULL,
    "sourcePlayerId" TEXT,
    "targetPlayerId" TEXT,
    "metadataJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RaceEngineEvent_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RaceItemTelemetry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "raceId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "loadoutKey" TEXT NOT NULL,
    "finalRank" INTEGER NOT NULL,
    "baselineRank" INTEGER NOT NULL,
    "rankDelta" INTEGER NOT NULL,
    "won" BOOLEAN NOT NULL,
    "topThree" BOOLEAN NOT NULL,
    "bottomTwo" BOOLEAN NOT NULL,
    "activated" BOOLEAN NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RaceItemTelemetry_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RacePickupTelemetry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "collectionRank" INTEGER NOT NULL,
    "finalRank" INTEGER NOT NULL,
    "baselineRank" INTEGER NOT NULL,
    "rankDelta" INTEGER NOT NULL,
    "activated" BOOLEAN NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "manualUsed" BOOLEAN NOT NULL,
    "autoUsed" BOOLEAN NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RacePickupTelemetry_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RaceParticipant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "raceId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "usedShield" BOOLEAN NOT NULL DEFAULT false,
    "shieldId" INTEGER,
    "shieldChargesAtStart" INTEGER,
    "shieldBackfired" BOOLEAN NOT NULL DEFAULT false,
    "initialRank" INTEGER,
    "gotScar" BOOLEAN NOT NULL DEFAULT false,
    "isClone" BOOLEAN NOT NULL DEFAULT false,
    "cloneOfUserId" INTEGER,
    "cloneIndex" INTEGER,
    "displayName" TEXT,
    "chestEffect" TEXT,
    "chestTargetUserId" INTEGER,
    "dragonEligible" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "RaceParticipant_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RaceParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Shield" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerId" INTEGER NOT NULL,
    "earnedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "earnedRaceId" INTEGER,
    "charges" INTEGER NOT NULL DEFAULT 5,
    "weeksUnused" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "consumedAt" DATETIME,
    "loanedToId" INTEGER,
    CONSTRAINT "Shield_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Shield_loanedToId_fkey" FOREIGN KEY ("loanedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MysteryChest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerId" INTEGER NOT NULL,
    "earnedFromRaceId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "effect" TEXT NOT NULL,
    "rngSeed" TEXT NOT NULL,
    "consumedRaceId" INTEGER,
    "consumedAt" DATETIME,
    "targetUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MysteryChest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WeeklyTick" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "weekKey" TEXT NOT NULL,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "brokenShields" INTEGER NOT NULL DEFAULT 0,
    "lostShields" INTEGER NOT NULL DEFAULT 0,
    "newBosses" INTEGER NOT NULL DEFAULT 0,
    "chestsIssued" INTEGER NOT NULL DEFAULT 0,
    "details" TEXT
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AppMigration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommentaryLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "raceId" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    CONSTRAINT "CommentaryLog_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommentaryJob" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "raceId" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "screenshotB64" TEXT NOT NULL,
    "isRaceEnd" BOOLEAN NOT NULL DEFAULT false,
    "participantNames" TEXT,
    "raceResults" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    CONSTRAINT "CommentaryJob_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DragonWeek" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonKey" TEXT NOT NULL DEFAULT 'default',
    "weekKey" TEXT NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "weekEnd" DATETIME NOT NULL,
    "star" INTEGER NOT NULL,
    "raceId" INTEGER,
    "awardedOrbId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DragonWeek_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DragonOrb" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "currentOwnerId" INTEGER NOT NULL,
    "originalOwnerId" INTEGER,
    "originalRaceId" INTEGER,
    "dragonWeekId" INTEGER,
    "seasonKey" TEXT NOT NULL DEFAULT 'default',
    "star" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'RACE_WIN',
    "lockedByTradeId" INTEGER,
    "lockedBySummonId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "voidedAt" DATETIME,
    CONSTRAINT "DragonOrb_currentOwnerId_fkey" FOREIGN KEY ("currentOwnerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DragonOrb_originalOwnerId_fkey" FOREIGN KEY ("originalOwnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DragonOrb_originalRaceId_fkey" FOREIGN KEY ("originalRaceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DragonOrb_dragonWeekId_fkey" FOREIGN KEY ("dragonWeekId") REFERENCES "DragonWeek" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DragonOrbEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orbId" INTEGER,
    "userId" INTEGER,
    "raceId" INTEGER,
    "tradeId" INTEGER,
    "summonId" INTEGER,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DragonOrbEvent_orbId_fkey" FOREIGN KEY ("orbId") REFERENCES "DragonOrb" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DragonOrbEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DragonOrbEvent_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DragonOrbEvent_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "DragonTrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DragonOrbEvent_summonId_fkey" FOREIGN KEY ("summonId") REFERENCES "DragonSummon" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DragonTrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "proposerId" INTEGER NOT NULL,
    "counterpartyId" INTEGER,
    "offeredOrbId" INTEGER NOT NULL,
    "requestedStar" INTEGER NOT NULL,
    "acceptedById" INTEGER,
    "acceptedOrbId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "cancelledAt" DATETIME,
    "voidedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DragonTrade_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DragonTrade_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DragonTrade_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DragonTrade_offeredOrbId_fkey" FOREIGN KEY ("offeredOrbId") REFERENCES "DragonOrb" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DragonTrade_acceptedOrbId_fkey" FOREIGN KEY ("acceptedOrbId") REFERENCES "DragonOrb" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DragonSummon" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "seasonKey" TEXT NOT NULL DEFAULT 'default',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "consumedOrbIdsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "blockedReason" TEXT,
    "grantedItemId" INTEGER,
    CONSTRAINT "DragonSummon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DragonItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "summonId" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'DRAGON_SCALE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'DRAGON_SUMMON',
    "label" TEXT NOT NULL DEFAULT 'Long Lân Hộ Mệnh',
    "subtitle" TEXT NOT NULL DEFAULT 'Vảy Rồng',
    "payloadJson" TEXT,
    "equippedForRaceId" INTEGER,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "equippedAt" DATETIME,
    "consumedAt" DATETIME,
    "voidedAt" DATETIME,
    CONSTRAINT "DragonItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DragonItem_summonId_fkey" FOREIGN KEY ("summonId") REFERENCES "DragonSummon" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DragonItem_equippedForRaceId_fkey" FOREIGN KEY ("equippedForRaceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DragonItemEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "raceId" INTEGER,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DragonItemEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DragonItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DragonItemEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DragonItemEvent_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Season" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weeks" INTEGER NOT NULL DEFAULT 12,
    "status" TEXT NOT NULL DEFAULT 'active',
    "championUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "Season_championUserId_fkey" FOREIGN KEY ("championUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SeasonPlayer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "accessToken" TEXT NOT NULL,
    "scars" INTEGER NOT NULL DEFAULT 0,
    "shields" INTEGER NOT NULL DEFAULT 0,
    "shieldsUsed" INTEGER NOT NULL DEFAULT 0,
    "predictionPoints" INTEGER NOT NULL DEFAULT 0,
    "kingStreak" INTEGER NOT NULL DEFAULT 0,
    "isKing" BOOLEAN NOT NULL DEFAULT false,
    "raceWins" INTEGER NOT NULL DEFAULT 0,
    "raceCount" INTEGER NOT NULL DEFAULT 0,
    "championshipPoints" INTEGER NOT NULL DEFAULT 0,
    "quackPoints" INTEGER NOT NULL DEFAULT 0,
    "rarePity" INTEGER NOT NULL DEFAULT 0,
    "epicPity" INTEGER NOT NULL DEFAULT 0,
    "legendaryPity" INTEGER NOT NULL DEFAULT 0,
    "cosmeticsOnboarded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeasonPlayer_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CosmeticAdminEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "playerId" INTEGER,
    "cosmeticId" TEXT,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CosmeticConfig" (
    "cosmeticId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "shopEligible" BOOLEAN,
    "gachaEligible" BOOLEAN,
    "priceOverride" INTEGER,
    "limitedLabel" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShopRotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" INTEGER NOT NULL,
    "weekKey" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "itemsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopRotation_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShopPurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonPlayerId" INTEGER NOT NULL,
    "rotationId" TEXT NOT NULL,
    "cosmeticId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopPurchase_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShopPurchase_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "ShopRotation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CurrencyTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonPlayerId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "raceId" INTEGER,
    "cosmeticId" TEXT,
    "gachaPullId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CurrencyTransaction_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CurrencyTransaction_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RaceWildAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" INTEGER NOT NULL,
    "seasonPlayerId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "wildItemInstanceId" TEXT NOT NULL,
    "clientActionId" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'USE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "authoritativeTick" INTEGER,
    "resultJson" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "RaceWildAction_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RaceWildAction_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlayerCosmetic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonPlayerId" INTEGER NOT NULL,
    "cosmeticId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceReferenceId" TEXT,
    "isNew" BOOLEAN NOT NULL DEFAULT true,
    "obtainedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlayerCosmetic_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlayerAppearance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonPlayerId" INTEGER NOT NULL,
    "bodyColorId" TEXT NOT NULL,
    "bodySkinId" TEXT,
    "faceId" TEXT,
    "headId" TEXT,
    "neckId" TEXT,
    "outfitId" TEXT,
    "backId" TEXT,
    "petId" TEXT,
    "auraId" TEXT,
    "trailId" TEXT,
    "finishId" TEXT,
    "nameplateId" TEXT,
    "favoriteId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerAppearance_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CosmeticPreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonPlayerId" INTEGER NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "appearanceJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CosmeticPreset_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GachaPull" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonPlayerId" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "rolledRarity" TEXT NOT NULL,
    "finalCosmeticId" TEXT,
    "wasDuplicate" BOOLEAN NOT NULL,
    "wasRerolled" BOOLEAN NOT NULL,
    "refundAmount" INTEGER NOT NULL,
    "rarePityBefore" INTEGER NOT NULL,
    "rarePityAfter" INTEGER NOT NULL,
    "epicPityBefore" INTEGER NOT NULL,
    "epicPityAfter" INTEGER NOT NULL,
    "legendaryPityBefore" INTEGER NOT NULL,
    "legendaryPityAfter" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GachaPull_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SeasonWeek" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "chaosType" TEXT NOT NULL,
    "chaosTargetUserId" INTEGER,
    "chaosTargetUserId2" INTEGER,
    "chaosPayload" TEXT,
    "chaosRevealedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "predictionsLockedAt" DATETIME,
    "raceId" INTEGER,
    "recap" TEXT,
    "resolvedAt" DATETIME,
    "raceSeed" TEXT,
    "chaosSeed" TEXT,
    "skippedPlayerIdsJson" TEXT,
    "previousRaceSeeds" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeasonWeek_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonWeek_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SeasonLoadout" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "weekId" INTEGER NOT NULL,
    "seasonPlayerId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "itemIdsJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeasonLoadout_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "SeasonWeek" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonLoadout_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SeasonPrediction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "weekId" INTEGER NOT NULL,
    "predictorPlayerId" INTEGER NOT NULL,
    "predictorUserId" INTEGER NOT NULL,
    "targetUserId" INTEGER NOT NULL,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeasonPrediction_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "SeasonWeek" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonPrediction_predictorPlayerId_fkey" FOREIGN KEY ("predictorPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonPrediction_predictorUserId_fkey" FOREIGN KEY ("predictorUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonPrediction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SeasonShieldChoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "weekId" INTEGER NOT NULL,
    "seasonPlayerId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeasonShieldChoice_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "SeasonWeek" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonShieldChoice_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SeasonReward" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeasonReward_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SeasonRedemption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "seasonPlayerId" INTEGER NOT NULL,
    "rewardId" INTEGER NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeasonRedemption_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonRedemption_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "SeasonReward" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_name_key" ON "User"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Race_createdAt_idx" ON "Race"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Race_isTest_createdAt_idx" ON "Race"("isTest", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Race_status_isTest_finishedAt_id_idx" ON "Race"("status", "isTest", "finishedAt", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RaceEngineEvent_raceId_tick_id_idx" ON "RaceEngineEvent"("raceId", "tick", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RaceEngineEvent_raceId_type_idx" ON "RaceEngineEvent"("raceId", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RaceItemTelemetry_itemId_createdAt_idx" ON "RaceItemTelemetry"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RaceItemTelemetry_loadoutKey_createdAt_idx" ON "RaceItemTelemetry"("loadoutKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RaceItemTelemetry_raceId_playerId_itemId_key" ON "RaceItemTelemetry"("raceId", "playerId", "itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RacePickupTelemetry_itemId_raceId_idx" ON "RacePickupTelemetry"("itemId", "raceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RacePickupTelemetry_playerId_raceId_idx" ON "RacePickupTelemetry"("playerId", "raceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RacePickupTelemetry_raceId_instanceId_key" ON "RacePickupTelemetry"("raceId", "instanceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RaceParticipant_userId_idx" ON "RaceParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RaceParticipant_raceId_userId_cloneIndex_key" ON "RaceParticipant"("raceId", "userId", "cloneIndex");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Shield_ownerId_status_idx" ON "Shield"("ownerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MysteryChest_ownerId_status_idx" ON "MysteryChest"("ownerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MysteryChest_earnedFromRaceId_idx" ON "MysteryChest"("earnedFromRaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MysteryChest_earnedFromRaceId_effect_idx" ON "MysteryChest"("earnedFromRaceId", "effect");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyTick_weekKey_key" ON "WeeklyTick"("weekKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommentaryLog_raceId_timestamp_idx" ON "CommentaryLog"("raceId", "timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommentaryJob_raceId_status_idx" ON "CommentaryJob"("raceId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CommentaryJob_status_createdAt_idx" ON "CommentaryJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonWeek_star_idx" ON "DragonWeek"("star");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonWeek_raceId_idx" ON "DragonWeek"("raceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DragonWeek_seasonKey_weekKey_key" ON "DragonWeek"("seasonKey", "weekKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrb_currentOwnerId_status_idx" ON "DragonOrb"("currentOwnerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrb_currentOwnerId_seasonKey_status_idx" ON "DragonOrb"("currentOwnerId", "seasonKey", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrb_originalRaceId_idx" ON "DragonOrb"("originalRaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrb_dragonWeekId_idx" ON "DragonOrb"("dragonWeekId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrb_star_idx" ON "DragonOrb"("star");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrb_lockedByTradeId_idx" ON "DragonOrb"("lockedByTradeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrb_lockedBySummonId_idx" ON "DragonOrb"("lockedBySummonId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DragonOrb_originalRaceId_source_key" ON "DragonOrb"("originalRaceId", "source");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrbEvent_orbId_idx" ON "DragonOrbEvent"("orbId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrbEvent_userId_createdAt_idx" ON "DragonOrbEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrbEvent_raceId_idx" ON "DragonOrbEvent"("raceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrbEvent_tradeId_idx" ON "DragonOrbEvent"("tradeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrbEvent_summonId_idx" ON "DragonOrbEvent"("summonId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonOrbEvent_type_createdAt_idx" ON "DragonOrbEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonTrade_proposerId_status_idx" ON "DragonTrade"("proposerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonTrade_counterpartyId_status_idx" ON "DragonTrade"("counterpartyId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonTrade_requestedStar_status_idx" ON "DragonTrade"("requestedStar", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonTrade_offeredOrbId_idx" ON "DragonTrade"("offeredOrbId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonTrade_acceptedOrbId_idx" ON "DragonTrade"("acceptedOrbId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonTrade_status_createdAt_idx" ON "DragonTrade"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonSummon_userId_status_idx" ON "DragonSummon"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonSummon_status_idx" ON "DragonSummon"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonSummon_grantedItemId_idx" ON "DragonSummon"("grantedItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonItem_userId_status_idx" ON "DragonItem"("userId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonItem_type_status_idx" ON "DragonItem"("type", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonItem_equippedForRaceId_idx" ON "DragonItem"("equippedForRaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonItemEvent_itemId_idx" ON "DragonItemEvent"("itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonItemEvent_userId_createdAt_idx" ON "DragonItemEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonItemEvent_raceId_idx" ON "DragonItemEvent"("raceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DragonItemEvent_type_createdAt_idx" ON "DragonItemEvent"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Season_key_key" ON "Season"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Season_status_createdAt_idx" ON "Season"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SeasonPlayer_accessToken_key" ON "SeasonPlayer"("accessToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonPlayer_seasonId_predictionPoints_idx" ON "SeasonPlayer"("seasonId", "predictionPoints");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonPlayer_seasonId_isKing_idx" ON "SeasonPlayer"("seasonId", "isKing");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonPlayer_seasonId_quackPoints_idx" ON "SeasonPlayer"("seasonId", "quackPoints");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SeasonPlayer_seasonId_userId_key" ON "SeasonPlayer"("seasonId", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CosmeticAdminEvent_createdAt_idx" ON "CosmeticAdminEvent"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CosmeticAdminEvent_playerId_createdAt_idx" ON "CosmeticAdminEvent"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShopRotation_startsAt_endsAt_idx" ON "ShopRotation"("startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShopRotation_seasonId_weekKey_key" ON "ShopRotation"("seasonId", "weekKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShopPurchase_rotationId_createdAt_idx" ON "ShopPurchase"("rotationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShopPurchase_seasonPlayerId_cosmeticId_key" ON "ShopPurchase"("seasonPlayerId", "cosmeticId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CurrencyTransaction_idempotencyKey_key" ON "CurrencyTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CurrencyTransaction_seasonPlayerId_createdAt_idx" ON "CurrencyTransaction"("seasonPlayerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CurrencyTransaction_raceId_reason_idx" ON "CurrencyTransaction"("raceId", "reason");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CurrencyTransaction_gachaPullId_idx" ON "CurrencyTransaction"("gachaPullId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RaceWildAction_raceId_status_requestedAt_idx" ON "RaceWildAction"("raceId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RaceWildAction_seasonPlayerId_requestedAt_idx" ON "RaceWildAction"("seasonPlayerId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RaceWildAction_raceId_playerId_clientActionId_key" ON "RaceWildAction"("raceId", "playerId", "clientActionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlayerCosmetic_seasonPlayerId_obtainedAt_idx" ON "PlayerCosmetic"("seasonPlayerId", "obtainedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlayerCosmetic_cosmeticId_idx" ON "PlayerCosmetic"("cosmeticId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PlayerCosmetic_seasonPlayerId_cosmeticId_key" ON "PlayerCosmetic"("seasonPlayerId", "cosmeticId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PlayerAppearance_seasonPlayerId_key" ON "PlayerAppearance"("seasonPlayerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CosmeticPreset_seasonPlayerId_updatedAt_idx" ON "CosmeticPreset"("seasonPlayerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CosmeticPreset_seasonPlayerId_slotIndex_key" ON "CosmeticPreset"("seasonPlayerId", "slotIndex");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GachaPull_seasonPlayerId_createdAt_idx" ON "GachaPull"("seasonPlayerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GachaPull_rolledRarity_createdAt_idx" ON "GachaPull"("rolledRarity", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SeasonWeek_raceId_key" ON "SeasonWeek"("raceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonWeek_seasonId_status_idx" ON "SeasonWeek"("seasonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SeasonWeek_seasonId_weekNumber_key" ON "SeasonWeek"("seasonId", "weekNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonLoadout_weekId_status_idx" ON "SeasonLoadout"("weekId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonLoadout_weekId_userId_idx" ON "SeasonLoadout"("weekId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SeasonLoadout_weekId_seasonPlayerId_key" ON "SeasonLoadout"("weekId", "seasonPlayerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonPrediction_weekId_targetUserId_idx" ON "SeasonPrediction"("weekId", "targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SeasonPrediction_weekId_predictorPlayerId_key" ON "SeasonPrediction"("weekId", "predictorPlayerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonShieldChoice_weekId_userId_idx" ON "SeasonShieldChoice"("weekId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SeasonShieldChoice_weekId_seasonPlayerId_key" ON "SeasonShieldChoice"("weekId", "seasonPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SeasonReward_seasonId_key_key" ON "SeasonReward"("seasonId", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonRedemption_seasonId_createdAt_idx" ON "SeasonRedemption"("seasonId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SeasonRedemption_seasonPlayerId_createdAt_idx" ON "SeasonRedemption"("seasonPlayerId", "createdAt");

