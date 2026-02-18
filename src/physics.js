/**
 * physics.js – Cannon-es physics world setup and helpers.
 */
import * as CANNON from 'cannon-es';
import { PHYSICS, FIELD, ROBOT, FUEL } from './config.js';

/** @type {CANNON.World} */
export let world;

/** @type {CANNON.Body} */
export let robotBody;

/** @type {CANNON.Body} */
export let groundBody;

/** @type {CANNON.Body[]} */
export const fuelBodies = [];

/** @type {CANNON.Body[]} */
export const shotBodies = [];

/** @type {CANNON.Body[]} */
export const fieldBodies = [];

// Materials for contacts
const robotMaterial = new CANNON.Material('robot');
const groundMaterial = new CANNON.Material('ground');
const fuelMaterial = new CANNON.Material('fuel');
const wallMaterial = new CANNON.Material('wall');

export function initPhysics() {
  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, PHYSICS.gravity, 0),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;

  // Contact materials
  world.addContactMaterial(new CANNON.ContactMaterial(robotMaterial, groundMaterial, {
    friction: 0.6,
    restitution: 0.1,
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(fuelMaterial, groundMaterial, {
    friction: 0.4,
    restitution: 0.5,
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(robotMaterial, wallMaterial, {
    friction: 0.3,
    restitution: 0.2,
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(fuelMaterial, wallMaterial, {
    friction: 0.4,
    restitution: 0.4,
  }));

  // ── Ground plane ──
  groundBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Plane(),
    material: groundMaterial,
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // ── Field walls (invisible barriers) ──
  const halfL = FIELD.length / 2;
  const halfW = FIELD.width / 2;
  const wallHeight = 1.0;
  const wallThickness = 0.2;
  const walls = [
    // +X wall
    { pos: [halfL + wallThickness / 2, wallHeight / 2, 0], size: [wallThickness / 2, wallHeight / 2, halfW] },
    // -X wall
    { pos: [-(halfL + wallThickness / 2), wallHeight / 2, 0], size: [wallThickness / 2, wallHeight / 2, halfW] },
    // +Z wall
    { pos: [0, wallHeight / 2, halfW + wallThickness / 2], size: [halfL, wallHeight / 2, wallThickness / 2] },
    // -Z wall
    { pos: [0, wallHeight / 2, -(halfW + wallThickness / 2)], size: [halfL, wallHeight / 2, wallThickness / 2] },
  ];
  for (const w of walls) {
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(...w.size)),
      material: wallMaterial,
    });
    body.position.set(...w.pos);
    world.addBody(body);
  }

  // ── Robot body ──
  // Use Sphere shape because cannon-es Trimesh only supports
  // collision with Sphere (not Box). The radius approximates the
  // robot's footprint so it can collide with field trimesh geometry.
  const robotRadius = Math.max(ROBOT.width, ROBOT.depth) / 2;
  robotBody = new CANNON.Body({
    mass: ROBOT.mass,
    shape: new CANNON.Sphere(robotRadius),
    material: robotMaterial,
    linearDamping: 0.0,
    angularDamping: 0.0,
  });
  robotBody.position.set(0, robotRadius + 0.01, 0);
  // Never let the robot sleep – we control it every frame
  robotBody.allowSleep = false;
  // Lock rotation to Y-axis only (no tipping)
  robotBody.angularFactor.set(0, 1, 0);
  robotBody.fixedRotation = false;
  world.addBody(robotBody);
}

/**
 * Create static Trimesh colliders from field meshes for detailed geometry contact.
 * @param {import('three').Object3D} object – the loaded & transformed field model
 */
export function addFieldColliders(object) {
  object.updateMatrixWorld(true);

  // Remove previously added field colliders if any
  for (const body of fieldBodies) {
    world.removeBody(body);
  }
  fieldBodies.length = 0;

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

    const trimesh = new CANNON.Trimesh(vertices, indices);

    const body = new CANNON.Body({
      mass: 0,
      material: wallMaterial,
    });
    body.addShape(trimesh);
    body.position.set(0, 0, 0);
    body.quaternion.set(0, 0, 0, 1);
    body.allowSleep = true;

    world.addBody(body);
    fieldBodies.push(body);
  });

  console.log(`[Physics] Created ${fieldBodies.length} field trimesh colliders`);
}

/**
 * Spawn a fuel sphere physics body at (x, y, z).
 * @returns {CANNON.Body}
 */
export function createFuelBody(x, z) {
  const body = new CANNON.Body({
    mass: FUEL.mass,
    shape: new CANNON.Sphere(FUEL.radius),
    material: fuelMaterial,
  });
  body.position.set(x, FUEL.radius + 0.5, z); // start slightly above ground to settle
  body.allowSleep = true;
  world.addBody(body);
  fuelBodies.push(body);
  return body;
}

/**
 * Remove a fuel body from the world.
 */
export function removeFuelBody(body) {
  world.removeBody(body);
  const idx = fuelBodies.indexOf(body);
  if (idx !== -1) fuelBodies.splice(idx, 1);
}

/**
 * Create a shot (ball) physics body launched from the robot.
 * @param {CANNON.Vec3} position
 * @param {CANNON.Vec3} velocity
 * @returns {CANNON.Body}
 */
export function createShotBody(position, velocity) {
  const body = new CANNON.Body({
    mass: FUEL.mass,
    shape: new CANNON.Sphere(FUEL.radius),
    material: fuelMaterial,
  });
  body.position.copy(position);
  body.velocity.copy(velocity);
  world.addBody(body);
  shotBodies.push(body);
  return body;
}

/**
 * Remove a shot body from the world.
 */
export function removeShotBody(body) {
  world.removeBody(body);
  const idx = shotBodies.indexOf(body);
  if (idx !== -1) shotBodies.splice(idx, 1);
}

/**
 * Step the physics world.
 */
export function stepPhysics(dt) {
  world.step(PHYSICS.fixedTimeStep, dt, PHYSICS.maxSubSteps);
}
