-- Scenario "main": week 1 resolved (with predictions and recap), week 2 open with odd payloads,
-- a live race for Thomas, loadouts, shield choices, presets, rewards with stock edge cases.
UPDATE "SeasonPlayer" SET shields = 2, predictionPoints = 12, isKing = 1, kingStreak = 2, scars = 1 WHERE id = 1;
UPDATE "SeasonPlayer" SET shields = 1, predictionPoints = 3 WHERE id = 2;
UPDATE "SeasonPlayer" SET predictionPoints = 10 WHERE id = 3;
UPDATE "User" SET googleId = '123456789012345678901', email = 'minh@example.com' WHERE id = 7;
UPDATE "SeasonWeek" SET status = 'resolved', recap = 'Tuần 1: "Thomas" thắng' || char(10) || 'dòng 2', resolvedAt = '2026-08-20T01:02:03.004+00:00', raceId = 37 WHERE id = 1;
INSERT INTO "SeasonPrediction" (weekId, predictorPlayerId, predictorUserId, targetUserId, pointsAwarded, createdAt) VALUES
  (1, 3, 1, 14, 2, '2026-08-18T01:00:00.000+00:00'), (1, 1, 14, 7, 0, '2026-08-18T01:00:01.000+00:00'), (1, 2, 7, 1, 1, '2026-08-18T01:00:02.000+00:00');
INSERT INTO "Race" (id, status, createdAt, isTest, engineState, engineVersion) VALUES (41, 'running', '2026-11-09T01:00:00.000+00:00', 0, 'RUNNING', '1.2.0'), (42, 'pending', '2026-11-09T02:00:00.000+00:00', 1, 'CREATED', '1.2.0'), (43, 'pending', '2026-11-09T03:00:00.000+00:00', 0, 'CREATED', NULL);
INSERT INTO "RaceParticipant" (raceId, userId) VALUES (41, 14), (41, 7), (42, 14), (43, 1);
INSERT INTO "SeasonWeek" (seasonId, weekNumber, status, chaosType, chaosTargetUserId, chaosTargetUserId2, chaosPayload, chaosRevealedAt, predictionsLockedAt, raceId, skippedPlayerIdsJson, createdAt, updatedAt)
  VALUES (1, 2, 'open', 'DUO', 7, 999, '[[2,5],[3,6.5e0,-0],[1e21]]', '2026-08-25T00:00:00.000+00:00', '2026-08-26T00:00:00.000+00:00', 41, '[4, 1.5, "2", -0, 1e21, 3]', '2026-08-25T00:00:00.000+00:00', '2026-08-25T00:00:00.000+00:00');
INSERT INTO "SeasonLoadout" (weekId, seasonPlayerId, userId, itemIdsJson, status, lockedAt, createdAt, updatedAt) VALUES
  (2, 2, 7, '["NITRO","BANANA"]', 'ready', '2026-08-25T01:00:00.000+00:00', '2026-08-25T01:00:00.000+00:00', '2026-08-25T01:00:00.000+00:00'),
  (2, 3, 1, '["FEATHER","QUACK_HORN"]', 'auto', NULL, '2026-08-25T01:00:00.000+00:00', '2026-08-25T01:00:00.000+00:00'),
  (2, 6, 6, '[]', 'draft', NULL, '2026-08-25T01:00:00.000+00:00', '2026-08-25T01:00:00.000+00:00');
INSERT INTO "SeasonShieldChoice" (weekId, seasonPlayerId, userId, confirmedAt) VALUES (2, 2, 7, '2026-08-25T02:00:00.000+00:00');
INSERT INTO "SeasonPrediction" (weekId, predictorPlayerId, predictorUserId, targetUserId, pointsAwarded, createdAt) VALUES (2, 2, 7, 1, 0, '2026-08-25T03:00:00.000+00:00');
INSERT INTO "CosmeticPreset" (id, seasonPlayerId, slotIndex, name, appearanceJson, createdAt, updatedAt) VALUES
  ('cpreset0000000000000000001', 1, 1, 'Đi chơi', '{"bodyColorId":"body-sunshine","faceId":"face-happy","extra":1}', '2026-08-25T00:00:00.000+00:00', '2026-08-25T00:00:00.000+00:00'),
  ('cpreset0000000000000000002', 1, 3, 'Null', 'null', '2026-08-25T00:00:00.000+00:00', '2026-08-25T00:00:00.000+00:00'),
  ('cpreset0000000000000000003', 1, 4, 'Array', '[1]', '2026-08-25T00:00:00.000+00:00', '2026-08-25T00:00:00.000+00:00'),
  ('cpreset0000000000000000004', 1, 5, 'Broken', '{oops', '2026-08-25T00:00:00.000+00:00', '2026-08-25T00:00:00.000+00:00'),
  ('cpreset0000000000000000005', 2, 2, 'Minh', '{"bodyColorId":"body-sunshine"}', '2026-08-25T00:00:00.000+00:00', '2026-08-25T00:00:00.000+00:00');
UPDATE "SeasonReward" SET active = 0 WHERE key = 'plush';
INSERT INTO "SeasonReward" (seasonId, key, name, cost, stock, active, createdAt) VALUES (1, 'sold_out', 'Hết hàng', 1, 0, 1, '2026-08-13T08:30:17.247+00:00'), (1, 'two_left', 'Còn 2', 1, 2, 1, '2026-08-13T08:30:17.247+00:00');
UPDATE "PlayerCosmetic" SET isNew = 1 WHERE seasonPlayerId = 1 AND rowid % 2 = 0;
DELETE FROM "PlayerAppearance" WHERE seasonPlayerId IN (4, 6);
DELETE FROM "PlayerCosmetic" WHERE seasonPlayerId = 5;
