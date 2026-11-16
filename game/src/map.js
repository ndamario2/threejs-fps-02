// DUSTLINE map: a 44 x 30 m desert freight yard at dusk. Flat ground, box and cylinder
// cover, two bomb sites (A "Silo" west, B "Depot" east), one mid lane. Every solid is a
// collider for movement and a surface a bullet stops on. Waypoints form the graph bots
// route on; BFS over it is the only pathfinding in the game.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const BOUNDS = { minX: -21.4, maxX: 21.4, minZ: -14.4, maxZ: 14.4 };
export const SITES = {
  A: { name: 'Silo', center: { x: -17, z: -10 }, half: { x: 4, z: 3 } },
  B: { name: 'Depot', center: { x: 17, z: -10 }, half: { x: 4, z: 3 } },
};
export const ATTACKER_SPAWN = [
  { x: 0, z: 12.5 }, { x: -6, z: 12 }, { x: -3, z: 13 }, { x: 3, z: 13 }, { x: 6, z: 12 },
];
export const DEFENDER_SPAWN = [
  { x: -15, z: -11 }, { x: -19, z: -7 }, { x: 15, z: -11 }, { x: 19, z: -7 }, { x: 0, z: -8 },
];

// [x, z] nodes; edges are bidirectional and symmetric where the yard is. Every node and
// every edge clears the map's solids by at least a bot radius — a waypoint inside a
// container, or an edge through the silo, strands the bot pushing into a wall.
const WAYPOINTS = [
  [0, 12.5], [-6, 12], [6, 12], [0, 6], [-14, 6], [14, 6], [-14, 1.5], [14, 1.5],
  [-7, 4.5], [7, 4.5], [-7, -6], [7, -6], [0, -6], [-12, -3], [12, -3],
  [-17, -10], [17, -10], [-20, -4], [20, -4], [-15, -9], [15, -9], [0, -12],
  [-8, 9], [8, 9],
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 22], [2, 23], [3, 22], [3, 23], [3, 4], [3, 5],
  [3, 8], [3, 9], [4, 6], [5, 7], [6, 13], [7, 14], [6, 17], [7, 18],
  [8, 10], [9, 11], [8, 6], [9, 7], [10, 12], [11, 12], [10, 13], [11, 14],
  [12, 21], [12, 13], [12, 14], [13, 15], [14, 16], [15, 17], [16, 18],
  [15, 19], [16, 20], [17, 19], [18, 20], [19, 17], [20, 18],
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const [name, color] of Object.entries(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
  }
  materials.steel.metalness = 0.45;
  materials.steel.roughness = 0.55;
  materials.steelDark.metalness = 0.4;

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(r, h, x, z, mat) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), materials[mat]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - r, 0, z - r), new THREE.Vector3(x + r, h, z + r)));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and worn patches.
  box(44.8, 0.4, 30.8, 0, -0.2, 0, 'sand');
  box(10, 0.06, 8, -12, 0.03, 4, 'sandDark', false);
  box(12, 0.06, 9, 10, 0.03, -2, 'sandDark', false);
  box(8, 0.06, 6, 0, 0.03, -9, 'sandDark', false);

  // Perimeter walls.
  box(0.6, 4, 30.8, -22.3, 2, 0, 'steelDark');
  box(0.6, 4, 30.8, 22.3, 2, 0, 'steelDark');
  box(44.8, 4, 0.6, 0, 2, -15.3, 'steelDark');
  box(44.8, 4, 0.6, 0, 2, 15.3, 'steelDark');

  // Site floor paint: A teal, B rust.
  box(8, 0.05, 6, -17, 0.05, -10, 'teal', false);
  box(8, 0.05, 6, 17, 0.05, -10, 'rust', false);

  // Central silo, the mid landmark.
  cylinder(2.2, 5.2, 0, -2, 'steel');
  cylinder(2.5, 0.3, 0, -2, 'rustDark');

  // North container row, with a mid gap for the defender spawn exit.
  box(6, 2.6, 2.4, -8, 1.3, -11.5, 'rust');
  box(6, 2.6, 2.4, 8, 1.3, -11.5, 'teal');
  box(6, 2.6, 2.4, -8, 3.9, -11.5, 'teal');
  box(6, 2.6, 2.4, 8, 3.9, -11.5, 'rust');

  // Mid cover.
  box(3, 2.4, 1.2, -4.5, 1.2, 2, 'teal');
  box(3, 2.4, 1.2, 4.5, 1.2, 3, 'rust');
  box(1.4, 1.1, 1.4, -2.5, 0.55, 9.5, 'rustDark');
  box(1.4, 1.1, 1.4, 2.5, 0.55, 9.5, 'steelDark');

  // Site A "Silo": a U of containers around the painted floor.
  box(1.2, 2.4, 4, -20.5, 1.2, -10, 'rust');
  box(4, 2.4, 1.2, -17, 1.2, -13.2, 'teal');
  box(1.2, 2.4, 2.4, -12.0, 1.2, -6.5, 'steel');

  // Site B "Depot": mirrored.
  box(1.2, 2.4, 4, 20.5, 1.2, -10, 'teal');
  box(4, 2.4, 1.2, 17, 1.2, -13.2, 'rust');
  box(1.2, 2.4, 2.4, 12.0, 1.2, -6.5, 'steel');

  // Lane crates and low jumpable cover. Kept off every waypoint edge (validated in the
  // headless test: each edge samples every 0.25 m and must clear all solids by 0.45 m).
  box(1.5, 1.5, 1.5, -10.5, 0.75, 9.5, 'steel');
  box(1.5, 1.5, 1.5, 10.5, 0.75, 9.5, 'steel');
  box(1.2, 1.2, 1.2, -10.5, 0.6, -1, 'rust');
  box(1.2, 1.2, 1.2, 10.5, 0.6, -1, 'teal');
  box(1.2, 0.7, 1.2, -3.5, 0.35, 9.0, 'rustDark');
  box(1.2, 0.7, 1.2, 3.5, 0.35, 9.0, 'rustDark');
  box(2, 1.4, 1.2, -10, 0.7, -6, 'steelDark');
  box(2, 1.4, 1.2, 10, 0.7, -6, 'steelDark');

  // Dusk lighting: low amber sun, mauve sky, warm bounce.
  const hemi = new THREE.HemisphereLight(new THREE.Color(0x8a6a8a), new THREE.Color(PALETTE.sandDark), 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xffb36b), 2.4);
  sun.position.set(-14, 10, 12);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x6a7a9a), 0.5);
  fill.position.set(12, 8, -10);
  scene.add(fill);

  // Waypoint graph.
  const nodes = WAYPOINTS.map(([x, z]) => ({ x, z }));
  const adj = nodes.map(() => []);
  for (const [a, b] of EDGES) {
    adj[a].push(b);
    adj[b].push(a);
  }

  function nearestWaypoint(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // BFS path: list of node indices from the waypoint nearest `from` to the one nearest `to`.
  function findPath(from, to) {
    const start = nearestWaypoint(from.x, from.z);
    const goal = nearestWaypoint(to.x, to.z);
    if (start === goal) return [goal];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [start];
    prev[start] = start;
    while (queue.length) {
      const current = queue.shift();
      if (current === goal) break;
      for (const next of adj[current]) {
        if (prev[next] === -1) {
          prev[next] = current;
          queue.push(next);
        }
      }
    }
    if (prev[goal] === -1) return [goal];
    const path = [];
    let node = goal;
    while (node !== start) {
      path.unshift(node);
      node = prev[node];
    }
    return path;
  }

  function inSite(pos, site) {
    const s = SITES[site];
    return Math.abs(pos.x - s.center.x) <= s.half.x && Math.abs(pos.z - s.center.z) <= s.half.z;
  }

  return { colliders, shootables, nodes, edges: EDGES, findPath, nearestWaypoint, inSite, group };
}
