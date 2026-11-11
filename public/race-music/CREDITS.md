# Race background music

Chill / lo-fi tracks from NoCopyrightSounds (NCS), trimmed to 96 s loops, loudness-normalised and
re-encoded at 64 kbps MP3 for the race canvas. Music provided by NoCopyrightSounds — https://ncs.io

| File | Track | Artist | NCS genre |
|---|---|---|---|
| `cruising.mp3` | Cruising | Aisake, Dosi | Lofi Hip-Hop |
| `miffy-cafe.mp3` | miffy cafe | sakuracloud | Lofi Hip-Hop |
| `apart.mp3` | apart | sumu | Lofi Hip-Hop |
| `up-in-flumes.mp3` | Up In Flumes | T-Mass | Chill |
| `long-road-home.mp3` | The Long Road Home | Inukshuk | Chill |
| `lune.mp3` | Lune | Y&V | Chill |

The track list and picker live in `components/racing/race-music.ts`. To add a track: download it from
ncs.io, then

```fish
ffmpeg -i in.mp3 -vn -t 96 -af "loudnorm=I=-20:TP=-2:LRA=11,afade=t=in:d=1,afade=t=out:st=92:d=4" \
  -ac 2 -ar 44100 -c:a libmp3lame -b:a 64k -map_metadata -1 public/race-music/<id>.mp3
```

and add it to `RACE_MUSIC` and this table.
