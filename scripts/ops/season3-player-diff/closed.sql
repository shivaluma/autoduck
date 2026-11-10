-- Scenario "closed": no open week (week 1 locked).
UPDATE "SeasonPlayer" SET shields = 1 WHERE id = 1;
UPDATE "SeasonWeek" SET status = 'locked', chaosPayload = '{"a":1}', skippedPlayerIdsJson = 'not json' WHERE id = 1;
