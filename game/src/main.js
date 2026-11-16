// DUSTLINE boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, range } from './rng.js';
import { createMap, SITES } from './map.js';
import { createAgent } from './agent.js';
import { createLoadout, WEAPONS, FRAG_PRICE, ARMOR_PRICE } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds, BUY_SECONDS } from './rounds.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const effects = createEffects(scene, camera);
const audio = createAudio();
const hud = createHud();
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = map.shootables.slice();
const direction = new THREE.Vector3();
const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();

// The player.
const playerMover = createAgent(map.colliders, 0, 12.5);
playerMover.state.yaw = 0;
const playerLoadout = createLoadout();
const player = {
  kind: 'player', id: 'player', name: 'You', team: 'atk',
  mover: playerMover, loadout: playerLoadout,
  hp: 100, armor: 0, alive: true, isCarrier: true,
};
// Invisible hit boxes so bots can shoot the player with the same raycast as each other.
const playerBodyMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.52, 1.02, 0.3),
  new THREE.MeshBasicMaterial({ visible: false }),
);
const playerHeadMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.32, 0.32, 0.32),
  new THREE.MeshBasicMaterial({ visible: false }),
);
playerBodyMesh.userData = { ref: player, part: 'body' };
playerHeadMesh.userData = { ref: player, part: 'head' };
scene.add(playerBodyMesh, playerHeadMesh);
shootables.push(playerBodyMesh, playerHeadMesh);

// Spike mesh: shown when dropped or planted, hidden while carried.
const spikeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.28, 0.4, 0.28),
  new THREE.MeshStandardMaterial({ color: PALETTE.accent, emissive: PALETTE.accent, emissiveIntensity: 0.7, roughness: 0.4 }),
);
spikeMesh.visible = false;
scene.add(spikeMesh);
const spikeLight = new THREE.PointLight(PALETTE.accent, 0, 6, 1.8);
scene.add(spikeLight);
let spikeDropped = null; // { x, z } when the carrier died

// Viewmodel: a simple gun at the bottom right of the camera.
const gun = new THREE.Group();
const gunBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.07, 0.11, 0.38),
  new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.45, metalness: 0.5 }),
);
const gunBarrel = new THREE.Mesh(
  new THREE.BoxGeometry(0.04, 0.04, 0.24),
  new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.4, metalness: 0.6 }),
);
gunBarrel.position.set(0, 0.03, -0.28);
gun.add(gunBody, gunBarrel);
gun.position.set(0.26, -0.22, -0.45);
camera.add(gun);
let gunKick = 0;

const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e3b2e, roughness: 0.6, metalness: 0.3 });

const allAgents = () => [player, ...bots.bots];

function syncPlayerHitMeshes() {
  const pos = playerMover.state.position;
  playerBodyMesh.position.set(pos.x, pos.y + 0.85, pos.z);
  playerHeadMesh.position.set(pos.x, pos.y + 1.56, pos.z);
}

function damage(ref, amount, isHead, attacker) {
  if (!ref.alive || rounds.rounds.phase !== 'live') return;
  let remaining = amount;
  if (ref.armor > 0) {
    const absorbed = Math.min(ref.armor, remaining * 0.5);
    ref.armor -= absorbed;
    remaining -= absorbed;
  }
  ref.hp -= remaining;
  if (ref.hp <= 0) {
    ref.hp = 0;
    kill(ref, attacker, isHead);
  }
}

function kill(victim, attacker, isHead) {
  victim.alive = false;
  if (victim.kind === 'bot') {
    victim.meshes.body.visible = false;
    victim.meshes.head.visible = false;
    // Remove from shootables so corpses stop blocking bullets.
    const bi = shootables.indexOf(victim.meshes.body);
    if (bi !== -1) shootables.splice(bi, 1);
    const hi = shootables.indexOf(victim.meshes.head);
    if (hi !== -1) shootables.splice(hi, 1);
  }
  const killerName = attacker ? attacker.name : 'The yard';
  const text = `${killerName} ▸ ${victim.name}${isHead ? '  [headshot]' : ''}`;
  hud.killfeed(text, attacker === player);
  if (attacker === player && victim.team !== 'atk') {
    rounds.rounds.money += 300;
    audio.kill();
    hud.setMoney(rounds.rounds.money);
  }
  if (victim.isCarrier) {
    victim.isCarrier = false;
    spikeDropped = { x: victim.mover.state.position.x, z: victim.mover.state.position.z };
    spikeMesh.position.set(spikeDropped.x, 0.4, spikeDropped.z);
    spikeMesh.visible = true;
    hud.setSpike('SPIKE DROPPED — recover it');
  }
  if (victim.kind === 'player') {
    playerLoadout.resetOnDeath();
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showOverlay('dead');
    hud.setSpike(spikeDropped ? 'SPIKE DROPPED — recover it' : 'SPIKE LOST WITH YOU');
  }
  checkRoundEnd();
}

function aliveCount(team) {
  return allAgents().filter((a) => a.team === team && a.alive).length;
}

function checkRoundEnd() {
  if (rounds.rounds.phase !== 'live') return;
  if (aliveCount('atk') === 0) rounds.endRound('def', 'Squad eliminated');
  else if (aliveCount('def') === 0) rounds.endRound('atk', 'Squad eliminated');
}

function explodeGrenade(grenade) {
  const index = grenades.indexOf(grenade);
  if (index !== -1) grenades.splice(index, 1);
  scene.remove(grenade.mesh);
  effects.explosion(grenade.mesh.position);
  audio.explosion();
  for (const agent of allAgents()) {
    if (!agent.alive) continue;
    const pos = agent.mover.state.position;
    const distance = Math.hypot(pos.x - grenade.mesh.position.x, pos.z - grenade.mesh.position.z);
    if (distance > 6) continue;
    const amount = (120 - (distance / 6) * 100) * (agent === player ? 0.5 : 1);
    damage(agent, amount, false, player);
  }
}

function throwGrenade() {
  if (playerLoadout.loadout.frags <= 0 || !player.alive) return;
  playerLoadout.loadout.frags -= 1;
  hud.setFrags(playerLoadout.loadout.frags);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  camera.getWorldDirection(direction);
  playerMover.eyePosition(tempA);
  mesh.position.copy(tempA).add(direction.clone().multiplyScalar(0.5));
  scene.add(mesh);
  grenades.push({
    mesh,
    velocity: direction.clone().multiplyScalar(17).add(new THREE.Vector3(0, 3.5, 0)),
    fuse: 1.6,
    bounced: false,
  });
  audio.click();
}

function stepGrenades(dt) {
  for (const grenade of [...grenades]) {
    grenade.fuse -= dt;
    grenade.velocity.y -= 12 * dt;
    const pos = grenade.mesh.position;
    const next = tempA.copy(pos).addScaledVector(grenade.velocity, dt);
    // Bounce off colliders, one axis at a time.
    const probe = new THREE.Box3();
    probe.min.set(next.x - 0.09, next.y - 0.09, next.z - 0.09);
    probe.max.set(next.x + 0.09, next.y + 0.09, next.z + 0.09);
    let hit = false;
    for (const collider of map.colliders) {
      if (!probe.intersectsBox(collider)) continue;
      hit = true;
      break;
    }
    if (hit) {
      if (Math.abs(grenade.velocity.x) > Math.abs(grenade.velocity.z)) grenade.velocity.x *= -0.45;
      else grenade.velocity.z *= -0.45;
      grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.4;
      if (!grenade.bounced) {
        grenade.bounced = true;
        grenade.fuse = Math.min(grenade.fuse, 1.2);
      }
    } else {
      pos.copy(next);
    }
    if (pos.y < 0.09) {
      pos.y = 0.09;
      grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.4;
      if (!grenade.bounced) {
        grenade.bounced = true;
        grenade.fuse = Math.min(grenade.fuse, 1.2);
      }
    }
    if (grenade.fuse <= 0) explodeGrenade(grenade);
  }
}

function playerShoot(spread) {
  if (!playerLoadout.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const rawHits = raycaster.intersectObjects(shootables, false);
  // The player's own invisible hit boxes sit around the camera; ignore them.
  const hit = rawHits.find((h) => h.object.userData.ref !== player);
  const end = hit ? hit.point : camera.position.clone().add(direction.clone().multiplyScalar(playerLoadout.def().range));
  playerMover.eyePosition(tempA);
  tempA.add(direction.clone().multiplyScalar(0.6));
  effects.tracer(tempA, end);
  effects.muzzle();
  audio.shot(playerLoadout.def().id);
  gunKick = 1;
  if (hit && hit.object.userData.ref) {
    const ref = hit.object.userData.ref;
    const isHead = hit.object.userData.part === 'head';
    const weapon = playerLoadout.def();
    damage(ref, weapon.damage * (isHead ? weapon.headMult : 1), isHead, player);
    hud.hitMarker(ref.hp <= 0, 120);
    if (ref.hp > 0) audio.hit();
  } else if (hit) {
    effects.impact(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));
  }
  playerMover.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  bots.hearShot(camera.position, 'atk');
  return true;
}

let playerChannel = null; // { kind: 'plant', site, progress }

function stepPlayerChannel(dt) {
  const inLive = rounds.rounds.phase === 'live' && player.alive && !rounds.rounds.plantedSite;
  const keys = input.state.keys;
  if (inLive && player.isCarrier && keys.has('KeyE')) {
    const site = map.inSite(playerMover.state.position, 'A') ? 'A'
      : map.inSite(playerMover.state.position, 'B') ? 'B' : null;
    if (site) {
      if (!playerChannel) playerChannel = { kind: 'plant', site, progress: 0 };
      playerChannel.progress += dt / 3.5;
      hud.channel(`PLANTING SPIKE — ${SITES[site].name}`, playerChannel.progress);
      if (Math.floor(playerChannel.progress * 7) !== Math.floor((playerChannel.progress - dt / 3.5) * 7)) audio.plantBeep();
      if (playerChannel.progress >= 1) {
        const doneSite = playerChannel.site;
        playerChannel = null;
        hud.hideChannel();
        player.isCarrier = false;
        rounds.plant(doneSite, playerMover.state.position);
        spikeMesh.position.set(playerMover.state.position.x, 0.4, playerMover.state.position.z);
        spikeMesh.visible = true;
        spikeLight.position.copy(spikeMesh.position);
        spikeLight.intensity = 6;
        audio.plantBeep();
        hud.banner('SPIKE PLANTED', `${SITES[doneSite].name} — hold the site`, 3000);
        hud.setSpike(`SPIKE PLANTED — ${SITES[doneSite].name}`);
      }
      return;
    }
  }
  if (playerChannel) {
    playerChannel = null;
    hud.hideChannel();
  }
}

const api = {
  raycaster,
  shootables,
  agents: allAgents,
  damage,
  tracer: (from, to) => effects.tracer(from, to),
  impact: (point, normal) => effects.impact(point, normal),
  shotSound(bot) {
    const distance = bot.mover.state.position.distanceTo(playerMover.state.position);
    if (distance < 32) audio.shot(bot.weaponId);
  },
  phase: () => rounds.rounds.phase,
  plantedSite: () => rounds.rounds.plantedSite,
  spikePlantedAt: () => rounds.rounds.plantedAt,
  spike: () => (spikeDropped ? { dropped: true, x: spikeDropped.x, z: spikeDropped.z } : { dropped: false }),
  pickupSpike(bot) {
    bot.isCarrier = true;
    spikeDropped = null;
    spikeMesh.visible = false;
    hud.setSpike(`${bot.name} carries the spike`);
  },
  plantTick() {},
  defuseTick(bot, progress) {
    hud.channel(`SENTINEL DEFUSING — ${Math.round(progress * 100)}%`, progress);
  },
  plantDone(bot) {
    const site = bot.site;
    bot.isCarrier = false;
    rounds.plant(site, bot.mover.state.position);
    spikeMesh.position.set(bot.mover.state.position.x, 0.4, bot.mover.state.position.z);
    spikeMesh.visible = true;
    spikeLight.position.copy(spikeMesh.position);
    spikeLight.intensity = 6;
    hud.banner('SPIKE PLANTED', `${SITES[site].name} — retake the site`, 3000);
    hud.setSpike(`SPIKE PLANTED — ${SITES[site].name}`);
  },
  defuseDone() {
    rounds.endRound('def', 'Spike defused');
  },
};

const bots = createBots(scene, map, random, api);

const rounds = createRounds({
  onBuyStart(round) {
    resetPositions();
    hud.showBuy(true);
    hud.refreshBuy(rounds.rounds.money, playerLoadout.owned, playerLoadout.loadout.frags);
    hud.banner(`ROUND ${round}`, 'Buy phase — B opens the shop', 2400);
    hud.setSpike(player.isCarrier ? 'SPIKE ON YOUR BACK' : 'SPIKE WITH A TEAMMATE');
  },
  onLiveStart() {
    hud.showBuy(false);
    hud.hideChannel();
    hud.banner(`ROUND ${rounds.rounds.round}`, 'Plant the spike at Silo or Depot', 2400);
  },
  onRoundEnd(winner, reason, wins) {
    hud.showBuy(false);
    hud.hideChannel();
    hud.hideBanner();
    if (winner === 'atk') {
      hud.banner('VANGUARD WINS', reason, 3600);
      audio.roundWin();
    } else {
      hud.banner('SENTINELS WIN', reason, 3600);
      audio.roundLose();
    }
    spikeMesh.visible = false;
    spikeLight.intensity = 0;
    spikeDropped = null;
    playerChannel = null;
  },
  onNextRound() {
    playerLoadout.refill();
    hud.setAmmo(playerLoadout.ammo().mag, playerLoadout.ammo().reserve, playerLoadout.def().name);
  },
  onMatchEnd(winner) {
    const text = winner === 'atk'
      ? `Vanguard take the yard ${rounds.rounds.wins.atk}–${rounds.rounds.wins.def}.`
      : `Sentinels hold the yard ${rounds.rounds.wins.def}–${rounds.rounds.wins.atk}.`;
    hud.showOverlay('matchEnd', text);
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onPlant() {},
});

function resetPositions() {
  bots.reset();
  // Restore bot hit meshes to the shootable list (killed bots had them removed).
  for (const bot of bots.bots) {
    if (!shootables.includes(bot.meshes.body)) shootables.push(bot.meshes.body);
    if (!shootables.includes(bot.meshes.head)) shootables.push(bot.meshes.head);
    bot.meshes.body.visible = true;
    bot.meshes.head.visible = true;
  }
  playerMover.state.position.set(0, 0, 12.5);
  playerMover.state.velocity.set(0, 0, 0);
  playerMover.state.yaw = 0;
  playerMover.state.pitch = 0;
  player.hp = 100;
  player.alive = true;
  player.isCarrier = true;
  for (const bot of bots.bots) if (bot.team === 'atk') bot.isCarrier = false;
  spikeDropped = null;
  spikeMesh.visible = false;
  spikeLight.intensity = 0;
  playerChannel = null;
  hud.hideChannel();
}

const input = createInput(renderer.domElement, onLockChange);
let started = false;
let spectateTarget = null;

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (rounds.rounds.phase === 'matchEnd') {
    rounds.resetMatch();
    playerLoadout.resetOnDeath();
    playerLoadout.refill();
    resetPositions();
    rounds.startBuy();
  }
  hud.hideOverlay();
  input.requestLock();
});

hud.onBuy((id) => {
  if (rounds.rounds.phase !== 'buy') return;
  const money = rounds.rounds.money;
  if (id === 'frag') {
    if (playerLoadout.loadout.frags >= 2 || money < FRAG_PRICE) return;
    rounds.rounds.money -= FRAG_PRICE;
    playerLoadout.loadout.frags += 1;
  } else if (id === 'armor') {
    if (player.armor >= 100 || money < ARMOR_PRICE) return;
    rounds.rounds.money -= ARMOR_PRICE;
    player.armor = 100;
  } else {
    const cost = playerLoadout.buy(id, money);
    if (cost < 0) return;
    rounds.rounds.money -= cost;
    playerLoadout.switchTo(id);
  }
  audio.click();
  hud.setMoney(rounds.rounds.money);
  hud.setFrags(playerLoadout.loadout.frags);
  hud.refreshBuy(rounds.rounds.money, playerLoadout.owned, playerLoadout.loadout.frags);
  hud.setAmmo(playerLoadout.ammo().mag, playerLoadout.ammo().reserve, playerLoadout.def().name);
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (rounds.rounds.phase !== 'matchEnd' && player.alive) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function syncCamera() {
  if (player.alive) {
    camera.position.set(
      playerMover.state.position.x,
      playerMover.state.position.y + playerMover.state.eye,
      playerMover.state.position.z,
    );
    camera.rotation.set(playerMover.state.pitch, playerMover.state.yaw, 0, 'YXZ');
  } else {
    if (!spectateTarget || !spectateTarget.alive) {
      spectateTarget = bots.bots.find((b) => b.team === 'atk' && b.alive) || null;
    }
    if (spectateTarget) {
      spectateTarget.mover.eyePosition(tempA);
      camera.position.copy(tempA);
      camera.rotation.set(spectateTarget.mover.state.pitch, spectateTarget.mover.state.yaw, 0, 'YXZ');
    }
  }
  gunKick = Math.max(0, gunKick - 0.12);
  gun.position.z = -0.45 + gunKick * 0.06;
  gun.position.y = -0.22 + gunKick * 0.02;
}

function step(dt, now) {
  rounds.tick(dt);
  const keys = input.state.keys;
  const phase = rounds.rounds.phase;

  if (player.alive && phase !== 'matchEnd') {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(playerMover.state.yaw);
    const cos = Math.cos(playerMover.state.yaw);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
      const length = Math.hypot(wishX, wishZ);
      wishX /= length;
      wishZ /= length;
    }
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    playerMover.step(dt, wishX, wishZ, keys.has('Space'), crouching);
    playerLoadout.step(dt);
    stepPlayerChannel(dt);
    if (phase === 'live' && input.state.firing && playerLoadout.ready()) {
      const weapon = playerLoadout.def();
      if (weapon.auto || input.consumePressed('MouseDown')) {
        playerShoot(playerLoadout.spreadFor(playerMover.groundSpeed(), !playerMover.state.onGround));
      }
    }
    if (input.consumePressed('KeyR')) playerLoadout.reload();
    if (input.consumePressed('KeyG') && phase === 'live') throwGrenade();
    if (input.consumePressed('Digit1')) playerLoadout.switchTo('pistol');
    if (input.consumePressed('Digit2')) playerLoadout.switchTo('smg');
    if (input.consumePressed('Digit3')) playerLoadout.switchTo('rifle');
    if (input.consumePressed('KeyB') && phase === 'buy') {
      hud.showBuy(document.getElementById('buy').hidden);
    }
  }

  bots.step(dt, now);
  stepGrenades(dt);
  effects.step(dt);
  syncPlayerHitMeshes();

  // Spike pickup by walking over it.
  if (spikeDropped && phase === 'live') {
    for (const agent of allAgents()) {
      if (!agent.alive || agent.team !== 'atk' || agent.isCarrier) continue;
      const pos = agent.mover.state.position;
      if (Math.hypot(pos.x - spikeDropped.x, pos.z - spikeDropped.z) < 1.4) {
        agent.isCarrier = true;
        spikeDropped = null;
        spikeMesh.visible = false;
        hud.setSpike(agent === player ? 'SPIKE ON YOUR BACK' : `${agent.name} carries the spike`);
        break;
      }
    }
  }

  // Blinking spike light while planted.
  if (rounds.rounds.plantedSite) {
    spikeLight.intensity = 4 + Math.sin(now * 6) * 3;
  }
  input.clearPressed();
}

function pushHud() {
  const r = rounds.rounds;
  hud.setAmmo(playerLoadout.ammo().mag, playerLoadout.ammo().reserve, playerLoadout.def().name);
  hud.setHealth(player.hp, player.armor);
  hud.setMoney(r.money);
  hud.setFrags(playerLoadout.loadout.frags);
  hud.setTimer(r.phaseTime, Boolean(r.plantedSite), r.fuseLeft);
  hud.setScore(r.wins.atk, r.wins.def, r.round);
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  const dt = Math.min((nowMs - lastTime) / 1000, 0.1);
  lastTime = nowMs;
  if (!frozen) {
    const look = input.takeLook();
    playerMover.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP, now);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    pushHud();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  const now = performance.now() / 1000;
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP, now + index * FIXED_STEP);
}

function aimAt(point) {
  const pos = playerMover.state.position;
  const dx = point.x - pos.x;
  const dy = point.y - (pos.y + playerMover.state.eye);
  const dz = point.z - pos.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  playerMover.state.yaw = Math.atan2(-dx, -dz);
  playerMover.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  rounds.resetMatch();
  resetPositions();
  if (name === 'start') {
    // Spawn view down the mid lane at dusk, buy panel open.
    playerMover.state.position.set(0, 0, 12.5);
    playerMover.state.yaw = 0;
    playerMover.state.pitch = 0.02;
    settle(30);
    syncCamera();
    hud.showBuy(true);
    hud.refreshBuy(rounds.rounds.money, playerLoadout.owned, playerLoadout.loadout.frags);
    hud.setSpike('SPIKE ON YOUR BACK');
  } else if (name === 'play') {
    // Eight seconds into a live round: bots mid-push, player firing down mid.
    rounds.startLive();
    player.hp = 9999; // the capture camera must survive the settle
    settle(60 * 8);
    const enemy = bots.bots.find((b) => b.team === 'def' && b.alive);
    if (enemy) {
      bots.eyeOf(enemy, tempA);
      aimAt(tempA);
      playerShoot(0);
      settle(6);
      playerShoot(0);
      settle(6);
    }
    syncCamera();
    hud.setSpike('SPIKE ON YOUR BACK');
  } else {
    // Round end: Vanguard win banner over site A, spike planted and blinking.
    rounds.startLive();
    player.hp = 9999;
    rounds.plant('A', { x: -17, z: -10 });
    rounds.endRound('atk', 'Spike detonated');
    hud.setSpike('SPIKE PLANTED — Silo');
    spikeMesh.position.set(-17, 0.4, -10);
    spikeMesh.visible = true;
    spikeLight.position.copy(spikeMesh.position);
    spikeLight.intensity = 6;
    playerMover.state.position.set(-13, 0, -4);
    playerMover.state.yaw = Math.atan2(4, 6);
    settle(20);
    syncCamera();
  }
  // The capture HUD must show the real numbers: shot mode's invulnerability is a
  // staging trick, not part of the game.
  player.hp = 100;
  player.armor = 0;
  document.getElementById('banner').style.transition = 'none';
  if (name === 'end') hud.bannerSticky('VANGUARD WINS', 'Spike detonated');
  pushHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    pushHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
pushHud();
// Debug handle for playtesting and the in-browser console: read-only view of the sim.
window.__dustline = { player, rounds: rounds.rounds, bots, loadout: playerLoadout };
if (shot) runShot(shot);
else requestAnimationFrame(frame);
