// Shared mover for the player and every bot: acceleration, friction, gravity, crouch and
// jump, resolved as a box against the map's colliders one axis at a time, so a wall never
// swallows an agent. Bots drive it with a wish direction; the player drives it with keys.
import * as THREE from 'three';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const STAND_EYE = 1.6;
export const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createAgent(colliders, x, z) {
  const agent = {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const probe = new THREE.Box3();

  function overlaps(xPos, yPos, zPos, height, lift) {
    probe.min.set(xPos - RADIUS, yPos + lift, zPos - RADIUS);
    probe.max.set(xPos + RADIUS, yPos + height - lift, zPos + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  // wishX/wishZ are a world-space direction (already yaw-relative), magnitude <= 1.
  function step(dt, wishX, wishZ, wantJump, wantCrouch, speedScale = 1) {
    const crouching = wantCrouch;
    if (crouching && !agent.crouching) {
      agent.crouching = true;
      agent.height = CROUCH_HEIGHT;
    } else if (!crouching && agent.crouching && !overlaps(agent.position.x, agent.position.y, agent.position.z, STAND_HEIGHT, 0.02)) {
      agent.crouching = false;
      agent.height = STAND_HEIGHT;
    }
    const eyeTarget = agent.crouching ? CROUCH_EYE : STAND_EYE;
    agent.eye += (eyeTarget - agent.eye) * Math.min(1, dt * 12);

    const speed = (agent.crouching ? CROUCH_SPEED : WALK_SPEED) * speedScale;
    const blend = Math.min(1, (agent.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    agent.velocity.x += (wishX * speed - agent.velocity.x) * blend;
    agent.velocity.z += (wishZ * speed - agent.velocity.z) * blend;
    if (agent.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      agent.velocity.x *= damp;
      agent.velocity.z *= damp;
    }

    if (wantJump && agent.onGround) {
      agent.velocity.y = JUMP_SPEED;
      agent.onGround = false;
    }
    agent.velocity.y -= GRAVITY * dt;

    const nextX = agent.position.x + agent.velocity.x * dt;
    if (!overlaps(nextX, agent.position.y, agent.position.z, agent.height, 0.04)) agent.position.x = nextX;
    else agent.velocity.x = 0;
    const nextZ = agent.position.z + agent.velocity.z * dt;
    if (!overlaps(agent.position.x, agent.position.y, nextZ, agent.height, 0.04)) agent.position.z = nextZ;
    else agent.velocity.z = 0;

    agent.position.y += agent.velocity.y * dt;
    agent.onGround = false;
    const hit = overlaps(agent.position.x, agent.position.y, agent.position.z, agent.height, 0);
    if (hit && agent.velocity.y <= 0) {
      agent.position.y = hit.max.y;
      agent.velocity.y = 0;
      agent.onGround = true;
    } else if (hit) {
      agent.position.y = hit.min.y - agent.height;
      agent.velocity.y = 0;
    }
    if (agent.position.y < 0) {
      agent.position.y = 0;
      agent.velocity.y = 0;
      agent.onGround = true;
    }
    agent.velocity.y = Math.max(-30, agent.velocity.y);
  }

  function look(dx, dy, sensitivity = 0.0022) {
    agent.yaw -= dx * sensitivity;
    agent.pitch = Math.max(-1.45, Math.min(1.45, agent.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    agent.pitch = Math.min(1.45, agent.pitch + pitchKick);
    agent.yaw += yawKick;
  }

  function groundSpeed() {
    return Math.hypot(agent.velocity.x, agent.velocity.z);
  }

  function eyePosition(out) {
    return out.set(agent.position.x, agent.position.y + agent.eye, agent.position.z);
  }

  return { state: agent, step, look, recoil, groundSpeed, eyePosition };
}
