-- Scenario "noseason": the season is completed (redeem still finds it; season3 GET/POST do not).
UPDATE "Season" SET status = 'completed' WHERE id = 1;
UPDATE "SeasonPlayer" SET predictionPoints = 5 WHERE id = 1;
