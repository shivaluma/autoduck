-- Race detail parity fixture (tests/races.rs). Applied on top of common::populated_db
-- (User 1 'Zịt Test', Season 1, SeasonPlayer 1 with token 'token-1'). The golden bodies in
-- this folder are the TS route's output on main for this exact DB (see tests/races.rs).
INSERT INTO "User" ("id","name","avatarUrl","shields","createdAt","updatedAt") VALUES
  (2,'Thomas',NULL,0,'2026-01-01T00:00:00.000+00:00','2026-01-01T00:00:00.000+00:00'),
  (3,'Zịt Bất Tử','https://example.com/a.png',9999,'2026-01-01T00:00:00.000+00:00','2026-01-01T00:00:00.000+00:00'),
  (4,'Zịt "Quote" \ Tab	End','/avatars/4.png',3,'2026-01-01T00:00:00.000+00:00','2026-01-01T00:00:00.000+00:00'),
  (5,'Zịt Năm',NULL,9998,'2026-01-01T00:00:00.000+00:00','2026-01-01T00:00:00.000+00:00');
INSERT INTO "SeasonPlayer" ("id","seasonId","userId","accessToken","createdAt","updatedAt") VALUES
  (2,1,3,'token-3','2026-01-01T00:00:00.000+00:00','2026-01-01T00:00:00.000+00:00'),
  (3,1,4,'token-4','2026-01-01T00:00:00.000+00:00','2026-01-01T00:00:00.000+00:00'),
  (4,1,5,'token-5','2026-01-01T00:00:00.000+00:00','2026-01-01T00:00:00.000+00:00');

-- 1: legacy race (no engine), clones, NULL and tied initialRank, tied commentary timestamps.
INSERT INTO "Race" ("id","status","videoUrl","finalVerdict","createdAt","finishedAt") VALUES
  (1,'finished','https://cdn.example.com/race-1.webm','Zịt Lợi khao nước! 🦆','2026-02-09T05:19:36.603+00:00','2026-02-09T05:20:01.009+00:00');
INSERT INTO "RaceParticipant" ("id","raceId","userId","usedShield","shieldId","shieldChargesAtStart","shieldBackfired","initialRank","gotScar","isClone","cloneOfUserId","cloneIndex","displayName","chestEffect","chestTargetUserId","dragonEligible") VALUES
  (1,1,4,1,7,2,1,2,0,0,NULL,NULL,NULL,'SWAP',5,1),
  (2,1,1,0,NULL,NULL,0,1,1,0,NULL,NULL,'Zịt Một',NULL,NULL,0),
  (3,1,2,0,NULL,NULL,0,NULL,0,0,NULL,NULL,NULL,NULL,NULL,1),
  (4,1,3,0,NULL,NULL,0,2,0,0,NULL,NULL,NULL,NULL,NULL,1),
  (5,1,1,0,NULL,NULL,0,NULL,0,1,1,1,'Zịt Một (clone)',NULL,NULL,1),
  (6,1,5,0,NULL,NULL,0,3,0,0,NULL,NULL,NULL,NULL,NULL,1);
INSERT INTO "CommentaryLog" ("id","raceId","timestamp","content") VALUES
  (1,1,12,'Second at 12'),(2,1,3,'First'),(3,1,12,'Third at 12 "quoted"'),(4,1,0,'Start
line two');

-- 2: finished engine race with a season week, predictions and odd JSON in config/metadata.
INSERT INTO "Race" ("id","status","createdAt","finishedAt","isTest","engineState","protocolVersion","engineVersion","balanceVersion","trackVersion","seedCommit","raceSeed","engineConfigJson","resultDigest") VALUES
  (2,'finished','2026-08-19T19:03:35.926+00:00','2026-08-19T19:05:00.000+00:00',0,'RESOLVED','1.0.0','1.2.0','S3.11','river-01-v2','commit-2','seed-2',
   '{"raceId":"2","seed":"seed-2","tickRate":60,"durationLimit":1.0,"big":1e21,"small":5e-7,"neg":-0,"players":[{"playerId":"1","name":"Zịt Một","cosmeticKey":"{\"a\":1}"},{"playerId":"3","name":"Zịt Bất Tử"}],"chaosConfig":{"type":"SWAP","2":"two","1":"one","weights":[0.1,0.25,1.50]},"loadouts":[{"playerId":"1","items":[]}],"unicode":"é 😀\u0001"}',
   'digest-2');
INSERT INTO "RaceParticipant" ("id","raceId","userId","initialRank","gotScar") VALUES
  (10,2,1,2,1),(11,2,3,1,0),(12,2,4,3,0);
INSERT INTO "RaceEngineEvent" ("id","raceId","type","tick","timestampWithinRaceMs","sourcePlayerId","targetPlayerId","metadataJson","createdAt") VALUES
  (5,2,'RACE_STARTED',0,0,NULL,NULL,'{}','2026-08-19T19:03:36.000+00:00'),
  (3,2,'ITEM_USED',30,500.0,'1','3','{"itemId":"BANANA","progress":0.194,"lateralOffset":-0.72,"10":"ten","2":"two","nested":{"b":[1.0,2.5e-8],"a":null}}','2026-08-19T19:03:36.000+00:00'),
  (4,2,'ITEM_USED',30,500.0000000000001,'3',NULL,'{"itemId":"ROCKET","big":123456789012345678901,"tiny":1e-320}','2026-08-19T19:03:36.000+00:00'),
  (1,2,'RACE_FINISHED',90,1500,NULL,NULL,'{"standings":["3","1","4"],"ms":1500.0}','2026-08-19T19:03:36.000+00:00');
INSERT INTO "SeasonWeek" ("id","seasonId","weekNumber","status","chaosType","raceId","createdAt","updatedAt") VALUES
  (1,1,1,'resolved','SWAP',2,'2026-08-18T00:00:00.000+00:00','2026-08-19T19:05:00.000+00:00');
INSERT INTO "SeasonPrediction" ("id","weekId","predictorPlayerId","predictorUserId","targetUserId","pointsAwarded","createdAt") VALUES
  (1,1,3,4,1,0,'2026-08-18T01:00:00.000+00:00'),
  (2,1,1,1,3,5,'2026-08-18T02:00:00.000+00:00'),
  (3,1,2,3,3,5,'2026-08-18T03:00:00.000+00:00');

-- 3: failed engine race (seed/config hidden, players still shown), no chaosConfig/loadouts.
INSERT INTO "Race" ("id","status","createdAt","engineState","protocolVersion","engineVersion","balanceVersion","trackVersion","seedCommit","raceSeed","engineConfigJson") VALUES
  (3,'failed','2026-08-20T10:00:00.000+00:00','FINISHED','1.0.0','1.2.0','S3.11','river-01-v2','commit-3','seed-3',
   '{"players":[{"playerId":"4"}],"chaosConfig":null,"loadouts":null}');

-- 4: running engine race, with a week in progress (predictions not revealed yet).
INSERT INTO "Race" ("id","status","createdAt","engineState","engineVersion","raceSeed","engineConfigJson") VALUES
  (4,'running','2026-08-21T10:00:00.000+00:00','RACING','1.2.0','seed-4','[1,2]');
INSERT INTO "SeasonWeek" ("id","seasonId","weekNumber","status","chaosType","raceId","createdAt","updatedAt") VALUES
  (2,1,2,'racing','NONE',4,'2026-08-21T00:00:00.000+00:00','2026-08-21T00:00:00.000+00:00');
INSERT INTO "SeasonPrediction" ("id","weekId","predictorPlayerId","predictorUserId","targetUserId","pointsAwarded","createdAt") VALUES
  (4,2,4,5,4,0,'2026-08-21T01:00:00.000+00:00');

-- 5: pending, empty engineVersion (engine null) and a non-object config.
INSERT INTO "Race" ("id","status","createdAt","engineState","engineVersion","raceSeed","engineConfigJson") VALUES
  (5,'pending','2026-08-22T10:00:00.000+00:00','CREATED','','seed-5','5');

-- 6: pending engine race with a config whose JSON is "null" and an empty string.
INSERT INTO "Race" ("id","status","createdAt","engineState","engineVersion","raceSeed","engineConfigJson") VALUES
  (6,'pending','2026-08-22T11:00:00.000+00:00','LOCKED','2.0.0',NULL,'null'),
  (7,'pending','2026-08-22T12:00:00.000+00:00','LOCKED','2.0.0','seed-7','');

-- 8, 9: stored JSON that JSON.parse refuses (read as null / {} by parseJsonOr on main).
INSERT INTO "Race" ("id","status","createdAt","engineVersion","engineConfigJson") VALUES
  (8,'finished','2026-08-23T10:00:00.000+00:00',NULL,'{bad'),
  (9,'finished','2026-08-23T11:00:00.000+00:00','1.2.0','{}');
INSERT INTO "RaceEngineEvent" ("id","raceId","type","tick","timestampWithinRaceMs","metadataJson","createdAt") VALUES
  (10,9,'RACE_STARTED',0,0,'not json','2026-08-23T11:00:00.000+00:00');

-- Replay tracks (plan §4.6, `replay`/`postRaceStats` and GET /api/races/:id/track). Race 2's bytes
-- are gzip(mtime 0) of tests/races.rs `track_payload()`.
--   2: finished, RECORDED, valid geometry id, statsJson with odd numbers/keys → mode track.
--   3: failed, UNAVAILABLE without bytes → mode none.
--   4: running with a track → mode none, no postRaceStats.
--   9: finished, VERIFIED_DIGEST, sha but no bytes, malformed geometry id, statsJson not JSON.
--   6: pending with stats → postRaceStats null.
INSERT INTO "RaceReplayTrack" ("raceId","format","source","fidelity","engineImpl","engineVersion","balanceVersion","trackVersion","trackGeometry","tickRate","tickCount","byteSha256","bytes","statsJson","createdAt") VALUES
  (2,'dtrk/1','LIVE_TS','RECORDED','ts','1.2.0','S3.11','river-01-v2','river-01-v2@deadbeef',60,90,'6d8eda4b99ed63bb9c1d6e31d2561f7baa84ffdd851afb94527cf531fa629cc2',X'1f8b0800000000000213edcfd7420e000080519111422a54b20a951452a1c84843a8fe7e424365532aa3a961ef54a46134b48b260d9155f64c850a6d0d2d8a5ce931baf8ce1b1c7da1c04464401f91818344070f193a4c6cf88891e2a3468f91182b29253d6efc041959b989f293264f993a4d4171fa8c994aca2ab35467aba9cf993b4f63bea696f682858b7474172fd15bba6cf90afd95068646c6ab4c56af596b6a662eb010ae5b6fb961e3262b6b1bdbcd76f60e5bb66edbbe63e7aedd7b1c9df63abbb8eedb7fe0a09bbb87a797f7211f5f3fffc3478e1e3b7ee2e4a9d367ce9e3b1f70213028f8e2a590cba161e11157ae5ebb1e19151d7323362e3e2131293925f5e6adb4f48cccacecdb777272f3f2ef16dcbb5ff8e0e1a3c74f8a8a9f3e7bfee2e5abd76fdebe7bffa1e4636959f9a7cf5f2a2aabbe7efb5e5d535b57dfd0f8a3a9b9a5f5675b7b4767d7afdfdd3d7ffef6fea34e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3af57e55ff0f4b2d318a284e0000','{"b":1.0,"a":[2e21,-0,5e-7],"10":"ten","nested":{"z":null}}','2026-08-19T19:05:00.000+00:00'),
  (3,'dtrk/1','BACKFILL','UNAVAILABLE','ts','1.2.0','S3.11','river-01-v2',NULL,60,0,NULL,NULL,NULL,'2026-08-20T10:00:00.000+00:00'),
  (4,'dtrk/1','LIVE_TS','RECORDED','ts','1.2.0','S3.11','river-01-v2','river-01-v2@0123abcd',60,10,'6d8eda4b99ed63bb9c1d6e31d2561f7baa84ffdd851afb94527cf531fa629cc2',X'1f8b0800000000000213edcfd7420e000080519111422a54b20a951452a1c84843a8fe7e424365532aa3a961ef54a46134b48b260d9155f64c850a6d0d2d8a5ce931baf8ce1b1c7da1c04464401f91818344070f193a4c6cf88891e2a3468f91182b29253d6efc041959b989f293264f993a4d4171fa8c994aca2ab35467aba9cf993b4f63bea696f682858b7474172fd15bba6cf90afd95068646c6ab4c56af596b6a662eb010ae5b6fb961e3262b6b1bdbcd76f60e5bb66edbbe63e7aedd7b1c9df63abbb8eedb7fe0a09bbb87a797f7211f5f3fffc3478e1e3b7ee2e4a9d367ce9e3b1f70213028f8e2a590cba161e11157ae5ebb1e19151d7323362e3e2131293925f5e6adb4f48cccacecdb777272f3f2ef16dcbb5ff8e0e1a3c74f8a8a9f3e7bfee2e5abd76fdebe7bffa1e4636959f9a7cf5f2a2aabbe7efb5e5d535b57dfd0f8a3a9b9a5f5675b7b4767d7afdfdd3d7ffef6fea34e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3a75ead4a953a74e9d3af57e55ff0f4b2d318a284e0000','{}','2026-08-21T10:00:00.000+00:00'),
  (9,'dtrk/1','BACKFILL','VERIFIED_DIGEST','ts','1.1.0','S3.10','river-01-v2','river-01-v2@DEADBEEF',60,0,'abc"def',NULL,'not json','2026-08-23T11:00:00.000+00:00'),
  (6,'dtrk/1','LIVE_TS','RECORDED','ts','2.0.0','S4.0','river-02','x@00000000
',60,0,NULL,NULL,'{"a":1}','2026-08-22T11:00:00.000+00:00');
