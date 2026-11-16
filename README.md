# DUSTLINE — Tactical Strike

[![make.fun](https://img.shields.io/badge/make.fun-threejs--fps--02-f0a830)](https://make.fun/bounty/threejs-fps-02)
[![three.js](https://img.shields.io/badge/three.js-0.187.0-2e7f7a)](https://threejs.org/)
[![owner](https://img.shields.io/badge/owner-cyeez1-35b6a8)](https://github.com/cyeez1)

A round-based tactical FPS in three.js. Five Vanguard attackers — you and four bot
squadmates — push a desert freight yard at dusk against five Sentinel defenders.
Plant the spike at **Silo** or **Depot**, hold the site until it detonates, and take
the yard: first to 5 round wins takes the match.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

| Key | Action |
| --- | --- |
| W A S D | Move (acceleration, friction, jump with Space, crouch with Ctrl) |
| Mouse | Look (pointer lock) |
| Click | Fire |
| R | Reload |
| B | Buy menu (between rounds) |
| 1 / 2 / 3 | Pistol / SMG / Rifle |
| G | Throw frag grenade |
| E | Plant the spike (in a site, while carrying it) / channel |

## The game

- **Rounds** — 12 s buy phase, 100 s live round, first to 5 wins (MR9). Win $3250,
  lose $1900, kill $300. Start $800.
- **Objective** — you carry the spike. Plant it at Silo or Depot (hold E, 3.5 s);
  the 35 s fuse then decides the round. If you die, the spike drops — a teammate
  picks it up by walking over it. Defenders defuse (5 s) to steal the round.
- **Guns** — P9 Sidearm (free), Rattler SMG ($1500), Longshot Rifle ($2700), frag
  grenade ($300), body armour ($650). Hitscan with headshot bonus (rifle headshot
  is a one-tap), recoil and spread that punish firing on the move, bloom on
  sustained fire.
- **Bots** — 9 bots on a waypoint graph: attackers push a site and plant,
  defenders hold, rotate on gunfire they hear, and rush a planted site to defuse.
  Line of sight, reaction delays, burst fire, accuracy that falls off with
  distance and target speed.
- **Map** — an original 44 × 30 m freight yard: central silo, container lanes,
  two bomb sites, dusk lighting in a sand / terracotta / teal palette. No
  borrowed maps, art, or names.
- **Feel** — tracers, muzzle flash, impact sparks, explosion, synthesised WebAudio
  gunshots (no audio files), kill feed, round banners, plant/defuse channel bar.

## Build

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, stdlib only) copies `game/` and `screenshots/` to the output
directory and writes `dossier.json` with the vendored make.fun library. The build
is deterministic: two runs to different directories are byte-identical.

Screenshots are deterministic captures of the game itself:
`?shot=start&seed=1` (buy phase), `?shot=play&seed=1` (mid-round combat),
`?shot=end&seed=1` (round won on a detonation).

## Layout

```
game/
  index.html            HUD + buy menu + overlays
  src/
    main.js             boot, fixed 60 Hz loop, shooting, grenades, shot mode
    map.js              yard geometry, colliders, waypoint graph, sites
    agent.js            shared mover: accel, friction, gravity, AABB collision
    bots.js             bot AI: routes, LOS, hearing, bursts, plant/defuse
    weapons.js          gun defs, loadout, spread/recoil, reload
    rounds.js           match state machine, money, fuse, win conditions
    effects.js          pooled tracers, muzzle flash, sparks, explosion
    audio.js            synthesised WebAudio SFX
    hud.js              DOM HUD, kill feed, banners, buy menu
    input.js            pointer lock, keys, edge-triggered presses
    palette.js          dusk palette
    rng.js              seeded RNG
  vendor/three/         three.js 0.187.0, byte-for-byte as shipped in the kit
```

## Licence

MIT — see `LICENSE`.
