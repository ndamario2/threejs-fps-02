// Bots: nine agents with roles, routes, line of sight, hearing, reaction delays and burst
// fire. Attackers push a site and plant; defenders hold, rotate on noise, and defuse after
// a plant. Decisions run on a staggered 0.15 s tick so nine bots never all think at once.
import * as THREE from 'three';
import { createAgent } from './agent.js';
import { WEAPONS, ARMOR_ABSORB } from './weapons.js';
import { PALETTE } from './palette.js';
import { SITES, ATTACKER_SPAWN, DEFENDER_SPAWN } from './map.js';
import { range } from './rng.js';

const ALLY_NAMES = ['Rook', 'Heron', 'Mira', 'Sable'];
const ENEMY_NAMES = ['Dune', 'Vex', 'Onyx', 'Kite', 'Bram'];
const BOT_WEAPON = ['rifle', 'rifle', 'smg', 'rifle', 'rifle'];
const VIEW_DISTANCE = 48;
const VIEW_HALF_ANGLE = 1.35; // ~77 degrees each side

export function createBots(scene, map, random, api) {
  const bots = [];
  const tempEye = new THREE.Vector3();
  const tempTarget = new THREE.Vector3();
  const tempDir = new THREE.Vector3();

  function buildMesh(team) {
    const group = new THREE.Group();
    const bodyColor = team === 'atk' ? PALETTE.ally : PALETTE.enemy;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 1.02, 0.3),
      new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8 }),
    );
    body.position.y = 0.85;
    body.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.32, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x8a6f52, roughness: 0.8 }),
    );
    head.position.y = 1.56;
    head.castShadow = true;
    const helmet = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.12, 0.36),
      new THREE.MeshStandardMaterial({ color: team === 'atk' ? PALETTE.teal : PALETTE.rustDark, roughness: 0.7 }),
    );
    helmet.position.y = 1.72;
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5, metalness: 0.5 }),
    );
    gun.position.set(0.2, 1.15, 0.35);
    group.add(body, head, helmet, gun);
    return { group, body, head };
  }

  function makeBot(index, team, spawn, name) {
    const meshes = buildMesh(team);
    scene.add(meshes.group);
    const mover = createAgent(map.colliders, spawn.x, spawn.z);
    const weaponId = BOT_WEAPON[index % BOT_WEAPON.length];
    const bot = {
      kind: 'bot',
      id: `bot-${team}-${index}`,
      name,
      team,
      teamIndex: index,
      mover,
      meshes,
      weaponId,
      hp: 100,
      armor: 0,
      alive: true,
      isCarrier: false,
      state: 'hold',
      site: team === 'def' ? (index < 2 ? 'A' : index < 4 ? 'B' : 'mid') : (index % 2 === 0 ? 'A' : 'B'),
      path: [],
      pathIndex: 0,
      holdPos: { x: spawn.x, z: spawn.z },
      holdYaw: team === 'atk' ? 0 : Math.PI,
      enemy: null,
      enemyVisibleAt: 0,
      reactionAt: 0,
      burstLeft: 0,
      fireCooldown: 0,
      pauseUntil: 0,
      aimTime: 0,
      thinkAt: index * 0.03,
      investigate: null,
      investigateUntil: 0,
      channel: null, // { kind: 'plant'|'defuse', progress: 0..1 }
      channelTarget: null,
      fallT: 0,
      skill: range(random, 0.75, 1.05), // reaction + accuracy multiplier
    };
    meshes.body.userData = { ref: bot, part: 'body' };
    meshes.head.userData = { ref: bot, part: 'head' };
    api.shootables.push(meshes.body, meshes.head);
    bots.push(bot);
    return bot;
  }

  function spawnAll() {
    for (let i = 0; i < 4; i += 1) makeBot(i, 'atk', ATTACKER_SPAWN[i + 1], ALLY_NAMES[i]);
    for (let i = 0; i < 5; i += 1) makeBot(i, 'def', DEFENDER_SPAWN[i], ENEMY_NAMES[i]);
  }

  function reset() {
    for (const bot of bots) {
      bot.hp = 100;
      bot.armor = 0;
      bot.alive = true;
      bot.isCarrier = false;
      bot.state = 'hold';
      bot.path = [];
      bot.pathIndex = 0;
      bot.enemy = null;
      bot.channel = null;
      bot.channelTarget = null;
      bot.fallT = 0;
      bot.investigate = null;
      bot.burstLeft = 0;
      bot.fireCooldown = 0;
      bot.pauseUntil = 0;
      bot.aimTime = 0;
      bot.meshes.group.rotation.set(0, 0, 0);
      bot.meshes.group.position.y = 0;
      bot.meshes.group.visible = true;
      bot.meshes.body.visible = true;
      bot.meshes.head.visible = true;
    }
    bots.forEach((bot) => {
      const spawn = bot.team === 'atk' ? ATTACKER_SPAWN[bot.teamIndex + 1] : DEFENDER_SPAWN[bot.teamIndex];
      bot.mover.state.position.set(spawn.x, 0, spawn.z);
      bot.mover.state.velocity.set(0, 0, 0);
      bot.mover.state.yaw = bot.team === 'atk' ? 0 : Math.PI;
      bot.holdPos = { x: spawn.x, z: spawn.z };
    });
  }

  function eyeOf(bot, out) {
    return bot.mover.eyePosition(out);
  }

  function chestOf(ref, out) {
    const pos = ref.kind === 'player' ? ref.mover.state.position : ref.mover.state.position;
    return out.set(pos.x, pos.y + 1.25, pos.z);
  }

  function headOf(ref, out) {
    const pos = ref.mover.state.position;
    return out.set(pos.x, pos.y + 1.55, pos.z);
  }

  // LOS: blocked by any hit that is neither the shooter's own body/head nor the
  // target's — the target's own mesh must not count as cover.
  function hasLineOfSight(shooter, target, fromEye, toPoint) {
    tempDir.copy(toPoint).sub(fromEye);
    const distance = tempDir.length();
    if (distance > VIEW_DISTANCE) return false;
    tempDir.normalize();
    api.raycaster.set(fromEye, tempDir);
    api.raycaster.far = distance;
    const hits = api.raycaster.intersectObjects(api.shootables, false);
    for (const hit of hits) {
      if (hit.object.userData.ref === shooter || hit.object.userData.ref === target) continue;
      return false;
    }
    return true;
  }

  function visibleEnemy(bot, now) {
    let best = null;
    let bestScore = Infinity;
    eyeOf(bot, tempEye);
    for (const other of api.agents()) {
      if (other.team === bot.team || !other.alive) continue;
      chestOf(other, tempTarget);
      const dx = tempTarget.x - tempEye.x;
      const dy = tempTarget.y - tempEye.y;
      const dz = tempTarget.z - tempEye.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > VIEW_DISTANCE) continue;
      const yawTo = Math.atan2(-dx, -dz);
      let yawDiff = yawTo - bot.mover.state.yaw;
      while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
      while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
      if (Math.abs(yawDiff) > VIEW_HALF_ANGLE) continue;
      if (!hasLineOfSight(bot, other, tempEye, tempTarget)) continue;
      const score = distance + (other.kind === 'player' ? 0 : 4);
      if (score < bestScore) {
        bestScore = score;
        best = other;
      }
    }
    return best;
  }

  function routeTo(bot, target) {
    bot.path = map.findPath(bot.mover.state.position, target);
    bot.pathIndex = 0;
    bot.state = 'route';
  }

  function followPath(bot, dt, speedScale) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = map.nodes[bot.path[bot.pathIndex]];
    const dx = node.x - bot.mover.state.position.x;
    const dz = node.z - bot.mover.state.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1.1) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const wishX = dx / distance;
    const wishZ = dz / distance;
    bot.mover.step(dt, wishX, wishZ, false, false, speedScale);
    const targetYaw = Math.atan2(-wishX, -wishZ);
    turnToward(bot, targetYaw, dt * 6);
    return false;
  }

  function turnToward(bot, targetYaw, rate) {
    let diff = targetYaw - bot.mover.state.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const stepSize = Math.max(-rate, Math.min(rate, diff));
    bot.mover.state.yaw += stepSize;
  }

  function aimAt(bot, target, dt) {
    eyeOf(bot, tempEye);
    chestOf(target, tempTarget);
    const dx = tempTarget.x - tempEye.x;
    const dy = tempTarget.y - tempEye.y;
    const dz = tempTarget.z - tempEye.z;
    const distance = Math.hypot(dx, dy, dz);
    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.asin(Math.max(-1, Math.min(1, dy / distance)));
    turnToward(bot, targetYaw, dt * 10);
    const pitchDiff = targetPitch - bot.mover.state.pitch;
    bot.mover.state.pitch += Math.max(-dt * 8, Math.min(dt * 8, pitchDiff));
  }

  function botShoot(bot, now) {
    const weapon = WEAPONS[bot.weaponId];
    if (now < bot.fireCooldown) return;
    if (bot.burstLeft <= 0) {
      if (now < bot.pauseUntil) return;
      bot.burstLeft = 3 + Math.floor(random() * 3);
      bot.pauseUntil = now + 0.5 + random() * 0.5;
    }
    bot.fireCooldown = now + 60 / weapon.rpm;
    bot.burstLeft -= 1;
    const enemy = bot.enemy;
    if (!enemy || !enemy.alive) return;
    eyeOf(bot, tempEye);
    chestOf(enemy, tempTarget);
    const distance = tempEye.distanceTo(tempTarget);
    const targetSpeed = enemy.mover.groundSpeed();
    // Angular error: small when aimed and still, worse at range, against a moving
    // target, and before the bot has settled on the target.
    const errorAngle = (0.004 + distance * 0.00012 + targetSpeed * 0.0012)
      * (1.6 - Math.min(1, bot.aimTime)) / bot.skill;
    const lateral = errorAngle * distance;
    tempTarget.x += (random() * 2 - 1) * lateral;
    tempTarget.y += (random() * 2 - 1) * lateral * 0.6;
    tempTarget.z += (random() * 2 - 1) * lateral;
    tempDir.copy(tempTarget).sub(tempEye).normalize();
    api.raycaster.set(tempEye, tempDir);
    api.raycaster.far = weapon.range;
    const rawHits = api.raycaster.intersectObjects(api.shootables, false);
    const hits = rawHits.filter((h) => h.object.userData.ref !== bot);
    const end = hits.length ? hits[0].point : tempEye.clone().add(tempDir.multiplyScalar(weapon.range));
    api.tracer(tempEye, end);
    api.shotSound(bot);
    if (hits.length && hits[0].object.userData.ref) {
      const ref = hits[0].object.userData.ref;
      const isHead = hits[0].object.userData.part === 'head';
      api.damage(ref, weapon.damage * (isHead ? 2.5 : 1), isHead, bot);
    } else if (hits.length) {
      api.impact(hits[0].point, hits[0].face ? hits[0].face.normal : new THREE.Vector3(0, 1, 0));
    }
  }

  function startChannel(bot, kind, target) {
    bot.channel = { kind, progress: 0 };
    bot.channelTarget = target;
  }

  function think(bot, now) {
    if (!bot.alive) return;
    const phase = api.phase();
    if (phase !== 'live') {
      bot.enemy = null;
      return;
    }
    const planted = api.plantedSite();
    const spike = api.spike();

    if (bot.team === 'atk') {
      if (planted) {
        // Planted: defend the site.
        const site = SITES[planted];
        const pos = bot.mover.state.position;
        if (!map.inSite(pos, planted)) routeTo(bot, { x: site.center.x, z: site.center.z });
        else {
          bot.state = 'hold';
          bot.holdPos = { x: pos.x, z: pos.z };
          bot.holdYaw = bot.mover.state.yaw;
        }
        return;
      }
      if (bot.isCarrier) {
        const site = SITES[bot.site];
        if (map.inSite(bot.mover.state.position, bot.site)) {
          if (!bot.channel || bot.channel.kind !== 'plant') startChannel(bot, 'plant', bot.site);
          bot.state = 'plant';
        } else if (!bot.channel) {
          routeTo(bot, { x: site.center.x, z: site.center.z });
        }
        return;
      }
      if (spike.dropped) {
        const carrier = api.agents().find((a) => a.isCarrier);
        if (!carrier) {
          const distance = Math.hypot(spike.x - bot.mover.state.position.x, spike.z - bot.mover.state.position.z);
          if (distance < 1.4) {
            api.pickupSpike(bot);
          } else if (bot.state !== 'route' || bot.path.length === 0) {
            routeTo(bot, { x: spike.x, z: spike.z });
          }
          return;
        }
      }
      if (bot.state === 'hold' && bot.path.length === 0) {
        const site = SITES[bot.site];
        routeTo(bot, { x: site.center.x + range(random, -2, 2), z: site.center.z + range(random, -2, 2) });
      }
      return;
    }

    // Defenders.
    if (planted) {
      const site = SITES[planted];
      const pos = bot.mover.state.position;
      if (map.inSite(pos, planted) && api.spikePlantedAt()) {
        if (!bot.channel || bot.channel.kind !== 'defuse') startChannel(bot, 'defuse', planted);
        bot.state = 'defuse';
      } else if (!bot.channel) {
        routeTo(bot, { x: site.center.x, z: site.center.z });
      }
      return;
    }
    if (bot.investigate && now < bot.investigateUntil) {
      if (bot.state !== 'route' || bot.path.length === 0) routeTo(bot, bot.investigate);
      return;
    }
    bot.investigate = null;
    // Hold the assigned spot; face the likely approach.
    bot.state = 'hold';
  }

  function stepBot(bot, dt, now) {
    if (!bot.alive) {
      if (bot.fallT < 1) {
        bot.fallT = Math.min(1, bot.fallT + dt * 3);
        bot.meshes.group.rotation.x = -Math.PI / 2 * bot.fallT;
        bot.meshes.group.position.y = 0.15 * bot.fallT;
      }
      return;
    }
    if (now >= bot.thinkAt) {
      bot.thinkAt = now + 0.15;
      think(bot, now);
    }

    const enemy = visibleEnemy(bot, now);
    if (enemy) {
      if (bot.enemy !== enemy) {
        bot.enemy = enemy;
        bot.reactionAt = now + (0.28 + random() * 0.35) / bot.skill;
        bot.aimTime = 0;
        bot.burstLeft = 0;
      }
      bot.aimTime += dt;
      aimAt(bot, enemy, dt);
      if (now >= bot.reactionAt) botShoot(bot, now);
      bot.channel = null; // taking fire breaks a plant/defuse channel
    } else {
      bot.enemy = null;
      bot.aimTime = 0;
    }

    if (bot.channel && !enemy) {
      const rate = bot.channel.kind === 'plant' ? 1 / 3.5 : 1 / 5;
      bot.channel.progress += dt * rate;
      if (bot.channel.kind === 'plant') api.plantTick(bot, bot.channel.progress);
      else api.defuseTick(bot, bot.channel.progress);
      if (bot.channel.progress >= 1) {
        if (bot.channel.kind === 'plant') api.plantDone(bot);
        else api.defuseDone(bot);
        bot.channel = null;
      }
      // Stand still and face the site while channelling.
      bot.mover.step(dt, 0, 0, false, false);
    } else if (bot.state === 'route') {
      // Advance while fighting: an attacker that stops at spawn to trade 30 m shots
      // never plants. Engaging slows the push but does not stop it.
      const arrived = followPath(bot, dt, enemy ? 0.55 : 0.92);
      if (arrived) {
        bot.state = 'hold';
        bot.holdPos = { x: bot.mover.state.position.x, z: bot.mover.state.position.z };
        // Face the ground that matters: attackers watch their site, defenders watch
        // the site they guard (or south, for the mid defender).
        const focus = bot.team === 'atk' ? SITES[bot.site]
          : bot.site === 'mid' ? { center: { x: bot.mover.state.position.x, z: bot.mover.state.position.z + 10 } }
          : SITES[bot.site];
        const fx = focus.center.x - bot.mover.state.position.x;
        const fz = focus.center.z - bot.mover.state.position.z;
        bot.holdYaw = Math.atan2(-fx, -fz);
        bot.mover.state.yaw = bot.holdYaw;
      }
    } else if (enemy) {
      // Holding and engaging: strafe a little while firing.
      const strafe = Math.sin(now * 1.7 + bot.id.charCodeAt(4)) * 0.5;
      const yaw = bot.mover.state.yaw;
      const wishX = Math.cos(yaw) * strafe;
      const wishZ = -Math.sin(yaw) * strafe;
      bot.mover.step(dt, wishX, wishZ, false, false, 0.35);
    } else {
      // Hold: slow wide sweep, so a bot watching a site eventually covers its flanks.
      bot.mover.step(dt, 0, 0, false, false);
      bot.mover.state.yaw = bot.holdYaw + Math.sin(now * 0.4 + bot.id.charCodeAt(4)) * 1.1;
    }

    // Sync the mesh to the mover.
    const pos = bot.mover.state.position;
    bot.meshes.group.position.set(pos.x, pos.y, pos.z);
    bot.meshes.group.rotation.y = bot.mover.state.yaw;
  }

  function hearShot(position, team) {
    for (const bot of bots) {
      if (!bot.alive || bot.team !== 'def') continue;
      const dx = position.x - bot.mover.state.position.x;
      const dz = position.z - bot.mover.state.position.z;
      if (Math.hypot(dx, dz) < 26) {
        bot.investigate = { x: position.x, z: position.z };
        bot.investigateUntil = performance.now() / 1000 + 6;
      }
    }
  }

  function step(dt, now) {
    for (const bot of bots) stepBot(bot, dt, now);
  }

  spawnAll();
  return { bots, reset, step, hearShot, chestOf, headOf, eyeOf, ARMOR_ABSORB };
}
