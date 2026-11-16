// Effects: tracers, muzzle flash, impact sparks and the bomb explosion. Everything is
// pooled — no geometry or material is allocated while the game runs.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 24;
const PARTICLES = 320;

export function createEffects(scene, camera) {
  // Tracer pool: one line each, reused round-robin.
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({
      color: PALETTE.accent, transparent: true, opacity: 0,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // Muzzle flash: a small amber quad parented to the camera plus a short-lived light.
  const flashMaterial = new THREE.MeshBasicMaterial({
    color: PALETTE.accent, transparent: true, opacity: 0, depthWrite: false,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMaterial);
  flash.position.set(0.16, -0.14, -0.6);
  camera.add(flash);
  const flashLight = new THREE.PointLight(PALETTE.accent, 0, 7, 1.6);
  flashLight.position.set(0.2, -0.1, -0.5);
  camera.add(flashLight);

  // Impact sparks: one Points cloud, ring-buffered.
  const sparkPositions = new Float32Array(PARTICLES * 3);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparkMaterial = new THREE.PointsMaterial({
    color: PALETTE.accent, size: 0.07, transparent: true, opacity: 0.95, depthWrite: false,
  });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sparkVel = new Float32Array(PARTICLES * 3);
  const sparkLife = new Float32Array(PARTICLES);
  let sparkIndex = 0;

  // Explosion: one expanding shell plus a light, reused.
  const boomMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc46b, transparent: true, opacity: 0, depthWrite: false,
  });
  const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), boomMaterial);
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xffa040, 0, 30, 1.4);
  scene.add(boomLight);
  let boomLife = 0;

  function tracer(from, to) {
    const slot = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACERS;
    const positions = slot.line.geometry.attributes.position.array;
    positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
    positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
    slot.line.geometry.attributes.position.needsUpdate = true;
    slot.line.material.opacity = 0.9;
    slot.life = 0.09;
  }

  function muzzle() {
    flashMaterial.opacity = 0.9;
    flash.rotation.z = Math.random() * Math.PI;
    flash.scale.setScalar(0.8 + Math.random() * 0.6);
    flashLight.intensity = 5;
  }

  function impact(point, normal, count = 10) {
    for (let i = 0; i < count; i += 1) {
      const index = sparkIndex;
      sparkIndex = (sparkIndex + 1) % PARTICLES;
      sparkPositions[index * 3] = point.x;
      sparkPositions[index * 3 + 1] = point.y;
      sparkPositions[index * 3 + 2] = point.z;
      const vx = (Math.random() * 2 - 1) * 2.4 + normal.x * 2;
      const vy = Math.random() * 2.4 + 0.8 + normal.y * 2;
      const vz = (Math.random() * 2 - 1) * 2.4 + normal.z * 2;
      sparkVel[index * 3] = vx;
      sparkVel[index * 3 + 1] = vy;
      sparkVel[index * 3 + 2] = vz;
      sparkLife[index] = 0.35 + Math.random() * 0.25;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
  }

  function explosion(point) {
    boom.position.copy(point);
    boom.scale.setScalar(0.5);
    boomMaterial.opacity = 0.9;
    boomLight.position.copy(point);
    boomLight.position.y += 1;
    boomLight.intensity = 60;
    boomLife = 0.7;
  }

  function step(dt) {
    for (const slot of tracers) {
      if (slot.life > 0) {
        slot.life -= dt;
        slot.line.material.opacity = Math.max(0, slot.life / 0.09) * 0.9;
      }
    }
    if (flashMaterial.opacity > 0) flashMaterial.opacity = Math.max(0, flashMaterial.opacity - dt * 14);
    if (flashLight.intensity > 0) flashLight.intensity = Math.max(0, flashLight.intensity - dt * 90);
    let anyAlive = false;
    for (let i = 0; i < PARTICLES; i += 1) {
      if (sparkLife[i] <= 0) continue;
      anyAlive = true;
      sparkLife[i] -= dt;
      sparkPositions[i * 3] += sparkVel[i * 3] * dt;
      sparkPositions[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPositions[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      sparkVel[i * 3 + 1] -= 9 * dt;
      if (sparkLife[i] <= 0) sparkPositions[i * 3 + 1] = -50; // park dead sparks underground
    }
    if (anyAlive) sparkGeometry.attributes.position.needsUpdate = true;
    if (boomLife > 0) {
      boomLife -= dt;
      const t = 1 - Math.max(0, boomLife) / 0.7;
      boom.scale.setScalar(0.5 + t * 7);
      boomMaterial.opacity = Math.max(0, 0.9 * (1 - t));
      boomLight.intensity = Math.max(0, 60 * (1 - t));
    }
  }

  return { tracer, muzzle, impact, explosion, step };
}
