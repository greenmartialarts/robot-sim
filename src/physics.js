/**
 * physics.js – Rapier physics world setup and helpers.
 *
 * Migration from cannon-es → @dimforge/rapier3d-compat.
 *
 * Why Rapier?
 *   cannon-es only supports Sphere vs Trimesh contact narrow-phase.
 *   Rapier natively supports ConvexPolyhedron vs Trimesh, enabling true
 *   mesh-shape robot colliders to interact with mesh-shape field colliders.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS, ROBOT_COLLIDER, FUEL } from './config.js';

// ── World ──────────────────────────────────────────────────────────────────
/** @type {RAPIER.World} */
export let world;

// ── Rigid bodies ───────────────────────────────────────────────────────────
/** @type {RAPIER.RigidBody} */
export let robotBody;

/** @type {RAPIER.RigidBody} */
export let groundBody;

/** @type {RAPIER.RigidBody[]} */
export const fuelBodies = [];

/** @type {RAPIER.RigidBody[]} */
export const shotBodies = [];

/** @type {RAPIER.RigidBody[]} – one static body per field mesh */
export const fieldBodies = [];

// ── Colliders (parallel to body arrays) ────────────────────────────────────
/** @type {RAPIER.Collider[]} */
export const robotColliders = [];

/** @type {RAPIER.Collider[]} */
export const groundColliders = [];

/** @type {RAPIER.Collider[]} – index matches fuelBodies */
export const fuelColliders = [];

/** @type {RAPIER.Collider[]} – index matches shotBodies */
export const shotColliders = [];

/** @type {RAPIER.Collider[]} – index matches fieldBodies */
export const fieldColliders = [];

// ── Shape metadata for hitbox debug visualisation ──────────────────────────
/**
 * Maps collider.handle → shape description used to build debug geometry.
 * @type {Map<number, object>}
 */
const _meta = new Map();

function _track(collider, meta) {
  _meta.set(collider.handle, meta);
  return collider;
}

function _untrack(collider) {
  _meta.delete(collider.handle);
}

/** Returns all currently active tracked colliders for hitbox debug. */
export function getAllTrackedColliders() {
  return [
    ...robotColliders,
    ...groundColliders,
    ...fieldColliders,
    ...fuelColliders,
    ...shotColliders,
  ];
}

/** Returns shape metadata for a tracked collider (used by debug renderer). */
export function getColliderMeta(collider) {
  return _meta.get(collider.handle);
}

// ── Collision groups ────────────────────────────────────────────────────────
// Rapier encodes groups as a 32-bit integer: (membership << 16) | filter.
// A contact occurs when:
//   (A.membership & B.filter) != 0  AND  (B.membership & A.filter) != 0
const GROUP_ROBOT = 0x0001;
const GROUP_FUEL  = 0x0002;
const GROUP_FIELD = 0x0004;

const GROUPS_ROBOT = (GROUP_ROBOT << 16) | (GROUP_FUEL  | GROUP_FIELD);
const GROUPS_FUEL  = (GROUP_FUEL  << 16) | (GROUP_ROBOT | GROUP_FIELD | GROUP_FUEL);
const GROUPS_FIELD = (GROUP_FIELD << 16) | (GROUP_ROBOT | GROUP_FUEL);

// ── Sub-step accumulator ───────────────────────────────────────────────────
let _accumulator = 0;

// ── Init ───────────────────────────────────────────────────────────────────
/**
 * Initialise the Rapier physics world.
 * Must be awaited because Rapier loads a WASM module.
 */
export async function initPhysics() {
  await RAPIER.init();

  world = new RAPIER.World({ x: 0.0, y: PHYSICS.gravity, z: 0.0 });
  world.timestep = PHYSICS.fixedTimeStep;

  // ── Ground – large flat cuboid, top face exactly at y = 0 ──
  groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(200, 0.5, 200)
    .setTranslation(0, -0.5, 0)
    .setFriction(0.5)
    .setRestitution(0.1)
    .setCollisionGroups(GROUPS_FIELD);
  const gc = world.createCollider(groundColliderDesc, groundBody);
  _track(gc, { type: 'groundbox', hx: 200, hy: 0.5, hz: 200, tx: 0, ty: -0.5, tz: 0 });
  groundColliders.push(gc);

  // ── Robot body – dynamic, convex hull added later via addRobotCollider ──
  const robotDesc = RAPIER.RigidBodyDesc.dynamic()
    .setLinearDamping(0.0)
    .setAngularDamping(0.0)
    .setCanSleep(false)
    .setTranslation(0, ROBOT_COLLIDER.bottom + 0.01, 0);
  robotBody = world.createRigidBody(robotDesc);
  // Lock X and Z rotation axes – robot can only rotate around Y
  robotBody.setEnabledRotations(false, true, false, false);
}

// ── Robot helpers ──────────────────────────────────────────────────────────
export function getRobotColliderBottomDistance() {
  return ROBOT_COLLIDER.bottom;
}

export function getRobotColliderFrontDistance() {
  return ROBOT_COLLIDER.front;
}

/**
 * Build a ConvexHull collider for the robot from its loaded 3-D mesh.
 *
 * Call this after normaliseModel / groundModel have been applied so the
 * model bottom surface sits at world y = 0.
 *
 * Hull vertices are shifted in body-local space so the lowest hull face is
 * at exactly –ROBOT_COLLIDER.bottom below the body origin, keeping visual
 * sync consistent with getRobotColliderBottomDistance().
 *
 * @param {import('three').Object3D} object – the positioned robot pivot group
 */
export async function addRobotCollider(object) {
  // Remove any existing robot colliders
  for (const c of robotColliders) {
    world.removeCollider(c, false);
    _untrack(c);
  }
  robotColliders.length = 0;

  object.updateMatrixWorld(true);

  // Collect all mesh vertices in world space
  const allVerts = [];
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const geo = child.geometry.clone();
    geo.applyMatrix4(child.matrixWorld);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      allVerts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
  });

  if (allVerts.length < 9) {
    console.warn('[Physics] Robot mesh has no geometry – using box fallback');
    _addRobotBoxFallback();
    return;
  }

  // Transform to body-local frame (subtract current body translation)
  const bp = robotBody.translation();
  const n = allVerts.length;
  const bodyVerts = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    bodyVerts[i]     = allVerts[i]     - bp.x;
    bodyVerts[i + 1] = allVerts[i + 1] - bp.y;
    bodyVerts[i + 2] = allVerts[i + 2] - bp.z;
  }

  // Align: shift Y so hull bottom is at exactly –ROBOT_COLLIDER.bottom
  let minY = Infinity;
  for (let i = 1; i < n; i += 3) {
    if (bodyVerts[i] < minY) minY = bodyVerts[i];
  }
  const yShift = -ROBOT_COLLIDER.bottom - minY;
  for (let i = 1; i < n; i += 3) {
    bodyVerts[i] += yShift;
  }

  const colliderDesc = RAPIER.ColliderDesc.convexHull(bodyVerts);
  if (!colliderDesc) {
    console.warn('[Physics] convexHull failed for robot – using box fallback');
    _addRobotBoxFallback();
    return;
  }

  colliderDesc
    .setFriction(0.6)
    .setRestitution(0.1)
    .setCollisionGroups(GROUPS_ROBOT);

  const collider = world.createCollider(colliderDesc, robotBody);
  _track(collider, { type: 'convex', verts: bodyVerts });
  robotColliders.push(collider);

  console.log(`[Physics] Robot convex-hull collider: ${n / 3} input vertices`);
}

/** Box collider fallback when convexHull computation fails. */
function _addRobotBoxFallback() {
  const minX = -ROBOT_COLLIDER.left;
  const maxX =  ROBOT_COLLIDER.right;
  const minY = -ROBOT_COLLIDER.bottom;
  const maxY =  ROBOT_COLLIDER.top;
  const minZ = -ROBOT_COLLIDER.front;
  const maxZ =  ROBOT_COLLIDER.back;

  const hx = (maxX - minX) / 2;
  const hy = (maxY - minY) / 2;
  const hz = (maxZ - minZ) / 2;
  const tx = (maxX + minX) / 2;
  const ty = (maxY + minY) / 2;
  const tz = (maxZ + minZ) / 2;

  const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setTranslation(tx, ty, tz)
    .setFriction(0.6)
    .setRestitution(0.1)
    .setCollisionGroups(GROUPS_ROBOT);

  const collider = world.createCollider(desc, robotBody);
  _track(collider, { type: 'box', hx, hy, hz, tx, ty, tz });
  robotColliders.push(collider);
}

// ── Field colliders ────────────────────────────────────────────────────────
/**
 * Create Trimesh colliders from the field model geometry.
 * Both fuel balls (spheres) and the robot (convex hull) interact with
 * trimesh natively in Rapier – no proxy box layer needed.
 * @param {import('three').Object3D} object – loaded and world-transformed field model
 */
export function addFieldColliders(object) {
  clearFieldColliders();
  object.updateMatrixWorld(true);

  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);

    const posAttr = geometry.getAttribute('position');
    if (!posAttr || posAttr.count < 3) return;

    const vertices = new Float32Array(posAttr.array);
    let indices;
    if (geometry.index && geometry.index.count >= 3) {
      indices = new Uint32Array(geometry.index.array);
    } else {
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    }

    if (vertices.length < 9 || indices.length < 3) return;

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setFriction(0.5)
      .setRestitution(0.1)
      .setCollisionGroups(GROUPS_FIELD);

    const collider = world.createCollider(colliderDesc, body);
    _track(collider, { type: 'trimesh', verts: vertices, indices });

    fieldBodies.push(body);
    fieldColliders.push(collider);
  });

  console.log(`[Physics] Created ${fieldColliders.length} field trimesh colliders`);
}

// ── Field collider lifecycle ───────────────────────────────────────────────
/** Remove all field colliders and their static bodies. */
export function clearFieldColliders() {
  for (const c of fieldColliders) _untrack(c);
  for (const b of fieldBodies) world.removeRigidBody(b); // also removes attached colliders
  fieldBodies.length = 0;
  fieldColliders.length = 0;
}

// ── Fuel bodies ────────────────────────────────────────────────────────────
/**
 * Spawn a fuel sphere physics body.
 * @param {number} x
 * @param {number} z
 * @returns {RAPIER.RigidBody}
 */
export function createFuelBody(x, z) {
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, FUEL.radius + 0.5, z)
    .setCanSleep(true);
  const body = world.createRigidBody(desc);

  const colliderDesc = RAPIER.ColliderDesc.ball(FUEL.radius)
    .setFriction(0.4)
    .setRestitution(0.5)
    .setCollisionGroups(GROUPS_FUEL);
  const collider = world.createCollider(colliderDesc, body);
  _track(collider, { type: 'ball', radius: FUEL.radius });

  fuelBodies.push(body);
  fuelColliders.push(collider);
  return body;
}

/**
 * Remove a fuel body from the world.
 * @param {RAPIER.RigidBody} body
 */
export function removeFuelBody(body) {
  const idx = fuelBodies.indexOf(body);
  if (idx !== -1) {
    _untrack(fuelColliders[idx]);
    fuelBodies.splice(idx, 1);
    fuelColliders.splice(idx, 1);
  }
  world.removeRigidBody(body);
}

// ── Shot bodies ────────────────────────────────────────────────────────────
/**
 * Create a shot (ball) physics body launched from the robot.
 * @param {{ x: number, y: number, z: number }} position
 * @param {{ x: number, y: number, z: number }} velocity
 * @returns {RAPIER.RigidBody}
 */
export function createShotBody(position, velocity) {
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setCanSleep(true);
  const body = world.createRigidBody(desc);
  body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);

  const colliderDesc = RAPIER.ColliderDesc.ball(FUEL.radius)
    .setFriction(0.4)
    .setRestitution(0.5)
    .setCollisionGroups(GROUPS_FUEL);
  const collider = world.createCollider(colliderDesc, body);
  _track(collider, { type: 'ball', radius: FUEL.radius });

  shotBodies.push(body);
  shotColliders.push(collider);
  return body;
}

/**
 * Remove a shot body from the world.
 * @param {RAPIER.RigidBody} body
 */
export function removeShotBody(body) {
  const idx = shotBodies.indexOf(body);
  if (idx !== -1) {
    _untrack(shotColliders[idx]);
    shotBodies.splice(idx, 1);
    shotColliders.splice(idx, 1);
  }
  world.removeRigidBody(body);
}

// ── Step ───────────────────────────────────────────────────────────────────
/**
 * Advance the simulation by dt seconds using fixed sub-steps.
 * @param {number} dt – frame delta in seconds
 */
export function stepPhysics(dt) {
  _accumulator += dt;
  let steps = 0;
  while (_accumulator >= PHYSICS.fixedTimeStep && steps < PHYSICS.maxSubSteps) {
    world.timestep = PHYSICS.fixedTimeStep;
    world.step();
    _accumulator -= PHYSICS.fixedTimeStep;
    steps++;
  }
  // Prevent spiral of death after long frame stalls
  if (_accumulator > PHYSICS.fixedTimeStep * 4) _accumulator = 0;
}
