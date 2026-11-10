# Builds the scenario SQL applied to a bootstrapped dev.db snapshot: week-1 prep rows (predictions,
# loadouts, shield choices) and item/pickup telemetry for races 28-37. Deterministic (seeded).
#   python3 prepare.py OUT.sql
import random, sys
r = random.Random(20261109)
out = []
T = "'2026-08-14T01:00:00.000+00:00'"
# seasonPlayer ids: user1->3, user2->4, user3->7, user4->8, user5->5, user6->6, user7->2, user14->1
out.append(f"INSERT INTO SeasonPrediction (weekId,predictorPlayerId,predictorUserId,targetUserId,pointsAwarded,createdAt) VALUES (1,4,2,3,0,{T}),(1,3,1,2,0,{T}),(1,5,5,3,0,{T}),(1,8,4,1,0,{T});")
out.append(f"""INSERT INTO SeasonLoadout (weekId,seasonPlayerId,userId,itemIdsJson,status,lockedAt,createdAt,updatedAt) VALUES (1,3,1,'["NITRO","BANANA"]','ready',NULL,{T},{T}),(1,5,5,'["NITRO","BANANA"]','draft',NULL,{T},{T}),(1,7,3,'["HOMING_ROCKET","QUACK_HORN"]','ready',NULL,{T},{T}),(1,6,6,'["BUBBLE_SHIELD","PADDLE_BURST"]','auto',{T},{T},{T});""")
out.append(f"INSERT INTO SeasonShieldChoice (weekId,seasonPlayerId,userId,confirmedAt) VALUES (1,4,2,{T}),(1,7,3,{T}),(1,8,4,{T});")
items = ["NITRO","BANANA","HOMING_ROCKET","QUACK_HORN","BUBBLE_SHIELD","PADDLE_BURST","DRAFT_FIN"]
pick = ["MYSTERY_BOX","WILD_BANANA","OIL_SLICK","TURBO_FEATHER","STORM_CLOUD"]
users = [1,2,3,4,5,6,7,14]
for race in range(28, 38):
    ranks = users[:]; r.shuffle(ranks)
    for pos, user in enumerate(ranks, 1):
        a, b = r.sample(items, 2)
        key = f"{a}+{b}"
        base = r.randint(1, 8)
        for item in (a, b):
            act = r.random() < 0.7
            out.append(f"INSERT INTO RaceItemTelemetry (raceId,playerId,itemId,loadoutKey,finalRank,baselineRank,rankDelta,won,topThree,bottomTwo,activated,succeeded,createdAt) VALUES ({race},'{user}','{item}','{key}',{pos},{base},{base-pos},{int(pos==1)},{int(pos<=3)},{int(pos>=7)},{int(act)},{int(act and r.random()<0.5)},{T});")
        for k in range(r.randint(0, 3)):
            act = r.random() < 0.6
            out.append(f"INSERT INTO RacePickupTelemetry (id,raceId,playerId,instanceId,itemId,collectionRank,finalRank,baselineRank,rankDelta,activated,succeeded,manualUsed,autoUsed,hitCount) VALUES ('p{race}-{user}-{k}',{race},'{user}','i{race}-{user}-{k}','{r.choice(pick)}',{r.randint(1,8)},{pos},{base},{base-pos},{int(act)},{int(act and r.random()<0.4)},{int(act and r.random()<0.5)},{int(act and r.random()<0.5)},{r.randint(0,3) if act else 0});")
open(sys.argv[1], "w").write("\n".join(out) + "\n")
