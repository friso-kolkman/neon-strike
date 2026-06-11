# NEON STRIKE

A fast 3D arcade FPS that runs in your browser. Vanilla JS + Three.js, zero assets — every sound is synthesized live with WebAudio, every model is built from primitives. Tuned for the M2 MacBook Air.

## Play

```bash
./play.sh
```

Then click ENTER THE GRID. That's it. (Any static server works: `python3 -m http.server 8765` in this folder.)

## Controls

| Input | Action |
|-------|--------|
| WASD | move |
| Mouse | aim |
| Click / hold F | shoot (F is the trackpad-friendly option) |
| Space | jump, press again mid-air for double jump |
| Shift | sprint |
| Q / right click | dash (i-frames — dash through bullets for a PERFECT DODGE) |
| 1-4 / wheel | switch weapons |
| M | mute |
| ESC | pause |

## The run

4 sectors, each with its own arena, color, and music:

1. **THE YARD** — grunts and spitters. Grab the scattergun at the center pedestal.
2. **CRIMSON FOUNDRY** — flyers and kamikaze volt-mites join. Pulse SMG + overdrive on the map.
3. **VIOLET SPRAWL** — tanks and splitters. The rocket launcher lives here. Rocket-jumping works.
4. **THE CORE** — a three-phase boss. Bullet rings, aimed bursts, summons, and a stomp if you hug it.

## Scoring systems (this is where the fun is)

- **Kill streaks** multiply score up to 3x; each chained kill plays the next note up a pentatonic ladder.
- **Style tags**: AERIAL, POINT BLANK, LONGSHOT, DASH KILL — they stack and pay.
- **DENIED**: every spawn is telegraphed by a 1s light beam. Kill the enemy as it materializes for +50%.
- **GRAZE**: near-missed bullets pay +25 and extend your streak timer. Dance through the boss rings.
- **PERFECT DODGE**: dash through a bullet for slow-mo and an instant dash refund. It chains.
- **LAST STAND**: the final enemy of a wave goes berserk — faster, beaconed, double score, double drops.
- Enemies have friendly fire and grudges: a tank shell that hits a grunt starts a fight you can watch.
- Red barrels chain. Mites explode on death — shoot one inside a pack.
- Multikills trigger slow-mo. Headshots pay double. High score persists in localStorage.

## Tech notes

- Three.js r160 from CDN via importmap, single `requestAnimationFrame` loop, fixed-clamp dt with a global timescale for slow-mo.
- Particles are a single 420-instance `InstancedMesh`; tracers and projectiles are pooled.
- No shadow maps — neon emissive + fog aesthetic keeps the GPU load trivial.
- Music is a 16-step lookahead sequencer (bass/kick/hats/arp) that adds layers as waves escalate.
- `?test=1` starts the game without pointer lock and exposes `window.__game` for automated testing; `?fps` shows the FPS meter.
