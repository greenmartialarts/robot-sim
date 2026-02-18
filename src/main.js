/**
 * main.js – Entry point for the FRC Swerve Robot Simulation.
 *
 * Orchestrates loading, scene setup, physics, 3D model placement,
 * the game loop, and the UI overlay.
 */
import * as THREE from 'three';
import { FUEL, ROBOT, FIELD, FIELD_BOUNDS } from './config.js';
import { initScene, scene, renderer, createBallMesh } from './scene.js';
import { initCamera, camera, updateCamera, switchCamera } from './camera.js';
import { initInput, consumeReset, consumeCameraSwitch } from './input.js';
import {
  initPhysics,
  stepPhysics,
  robotBody,
  createFuelBody,
  removeFuelBody,
  fuelBodies,
  removeShotBody,
  shotBodies,
  addFieldColliders,
} from './physics.js';
import { updateRobot, resetRobot, getRobotBallCount } from './robot.js';
import { loadFBX, normalizeModel, groundModel, enableShadows } from './loader.js';

// ── DOM refs ──
const loadingScreen = document.getElementById('loading-screen');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');
const hudBalls = document.getElementById('hud-balls');
const hudShots = document.getElementById('hud-shots');
const cameraLabel = document.getElementById('camera-label');

// ── Live object tracking ──
let robotMesh = null;

/** @type {{ mesh: THREE.Object3D, body: import('cannon-es').Body }[]} */
const fuels = [];

/** @type {{ mesh: THREE.Object3D, body: import('cannon-es').Body, spawnTime: number }[]} */
const shots = [];

// Track shots made locally (robot.js exports aren't live references for primitives)
let _localShotsMade = 0;

// ── Goal scoring zone (approximate high goal position) ──
const GOAL_POSITION = new THREE.Vector3(0, 2.5, FIELD.width / 2);
const GOAL_RADIUS = 1.5;

/** Generate a random position within the fuel spawn area. */
function randomFuelPos() {
  const a = FUEL.spawnArea;
  return {
    x: a.xMin + Math.random() * (a.xMax - a.xMin),
    z: a.zMin + Math.random() * (a.zMax - a.zMin),
  };
}

// ── Bootstrap ──
async function main() {
  // Init subsystems
  initScene();
  initCamera();
  initInput();
  initPhysics();

  // ── Load models ──
  const progress = { field: 0, robot: 0, fuel: 0 };
  const updateLoadingBar = () => {
    const total = (progress.field + progress.robot + progress.fuel) / 3;
    loadingBar.style.width = `${(total * 100).toFixed(0)}%`;
  };

  loadingText.textContent = 'Loading field...';
  let fieldModel, robotModel, fuelModel;

  try {
    [fieldModel, robotModel, fuelModel] = await Promise.all([
      loadFBX('/field-2026.fbx', (p) => { progress.field = p; updateLoadingBar(); }),
      loadFBX('/Robot.fbx', (p) => { progress.robot = p; updateLoadingBar(); }),
      loadFBX('/Fuel.fbx', (p) => { progress.fuel = p; updateLoadingBar(); }),
    ]);
  } catch (err) {
    loadingText.textContent = `Error loading models: ${err.message}`;
    console.error(err);
    return;
  }

  loadingText.textContent = 'Setting up scene...';

  // ── Field ──
  normalizeModel(fieldModel, FIELD.length);
  groundModel(fieldModel);
  enableShadows(fieldModel, false, true);
  scene.add(fieldModel);

  // Build physics trimesh colliders from the field geometry
  fieldModel.updateMatrixWorld(true);
  addFieldColliders(fieldModel);

  // ── Robot ──
  // Wrap in a pivot group so we can apply a model-level rotation offset
  // while syncing the outer container to the physics body each frame.
  normalizeModel(robotModel, ROBOT.width);

  // The FBX model's native orientation has the robot on its side.
  // We need to rotate it so the wheels point down (+Y is up).
  // Pivot group lets us try rotations without messing up physics sync.
  const robotPivot = new THREE.Group();
  robotPivot.add(robotModel);

  // Try rotating until wheels face down.  From the screenshot the wheels
  // were pointing in +X (right), so rotate around Z by +90°.
  robotPivot.rotation.z = Math.PI / 2;

  // Re-ground: compute world-space bounding box after rotation
  robotPivot.updateMatrixWorld(true);
  const rBox = new THREE.Box3().setFromObject(robotPivot);
  // Shift the inner pivot so the bottom of the model sits at local y = 0
  robotPivot.position.y -= rBox.min.y;

  enableShadows(robotPivot, true, true);

  const robotContainer = new THREE.Group();
  robotContainer.add(robotPivot);
  robotMesh = robotContainer;
  scene.add(robotMesh);

  // ── Fuel instances ──
  // Normalise the template, then wrap in container for proper positioning.
  normalizeModel(fuelModel, FUEL.radius * 2);
  fuelModel.updateMatrixWorld(true);
  const fBox = new THREE.Box3().setFromObject(fuelModel);
  fuelModel.position.y -= fBox.min.y; // bottom sits at local y=0
  enableShadows(fuelModel, true, true);

  // Build a template container; we will clone this for each fuel spawn
  const fuelTemplate = new THREE.Group();
  fuelTemplate.add(fuelModel);

  // Spawn 20 balls at random positions in the spawn area
  for (let i = 0; i < FUEL.totalBalls; i++) {
    const pos = randomFuelPos();
    spawnFuel(pos.x, pos.z, fuelTemplate);
  }

  // ── Hide loading screen ──
  loadingBar.style.width = '100%';
  loadingText.textContent = 'Ready!';
  await new Promise((r) => setTimeout(r, 400));
  loadingScreen.classList.add('hidden');

  // ── Start game loop ──
  const clock = new THREE.Clock();
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05); // cap at 50 ms

    // Handle reset
    if (consumeReset()) {
      resetRobot();
      // Respawn all fuel
      clearAllFuel();
      clearAllShots();
      for (let i = 0; i < FUEL.totalBalls; i++) {
        const pos = randomFuelPos();
        spawnFuel(pos.x, pos.z, fuelTemplate);
      }
      _localShotsMade = 0;
    }

    // Camera switching
    const camSwitch = consumeCameraSwitch();
    if (camSwitch) switchCamera(camSwitch);
    const camLabel = updateCamera();
    cameraLabel.textContent = camLabel;

    // Robot controller
    const fuelMeshes = fuels.map((f) => f.mesh);
    updateRobot(
      dt,
      fuelMeshes,
      // onPickup
      (index) => {
        const f = fuels[index];
        scene.remove(f.mesh);
        removeFuelBody(f.body);
        fuels.splice(index, 1);
      },
      // onShoot
      (shotBody) => {
        const ballMesh = createBallMesh(FUEL.radius, 0x44aaff);
        scene.add(ballMesh);
        shots.push({ mesh: ballMesh, body: shotBody, spawnTime: performance.now() });
        _localShotsMade++;
      },
    );

    // Step physics
    stepPhysics(dt);

    // ── Sync Three.js transforms with Cannon ──
    // Robot: physics uses a sphere of radius max(width,depth)/2.
    // Visual container has model bottom at local y=0, so offset by radius.
    const robotRadius = Math.max(ROBOT.width, ROBOT.depth) / 2;
    robotMesh.position.set(
      robotBody.position.x,
      robotBody.position.y - robotRadius,
      robotBody.position.z,
    );
    robotMesh.quaternion.set(
      robotBody.quaternion.x,
      robotBody.quaternion.y,
      robotBody.quaternion.z,
      robotBody.quaternion.w,
    );

    // Fuel – container inner model bottom is at local y=0;
    // physics sphere center is at radius above ground.
    // Also check out-of-bounds and respawn.
    for (let i = fuels.length - 1; i >= 0; i--) {
      const f = fuels[i];
      f.mesh.position.set(
        f.body.position.x,
        f.body.position.y - FUEL.radius,
        f.body.position.z,
      );

      // Out-of-bounds or fell off field → respawn
      const oob =
        Math.abs(f.body.position.x) > FIELD_BOUNDS.xHalf ||
        Math.abs(f.body.position.z) > FIELD_BOUNDS.zHalf ||
        f.body.position.y < -2;
      if (oob) {
        scene.remove(f.mesh);
        removeFuelBody(f.body);
        fuels.splice(i, 1);
        const pos = randomFuelPos();
        spawnFuel(pos.x, pos.z, fuelTemplate);
      }
    }

    // Shots – sync, check for ground contact, and handle timeout
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.mesh.position.set(s.body.position.x, s.body.position.y, s.body.position.z);

      const age = performance.now() - s.spawnTime;
      const onGround = s.body.position.y <= FUEL.radius + 0.05;

      if (onGround && !s.landed) {
        // Ball has touched the ground – convert it back to a pickupable fuel ball
        s.landed = true;
        scene.remove(s.mesh);
        removeShotBody(s.body);
        shots.splice(i, 1);
        // Spawn a new fuel at the landing spot
        spawnFuel(s.body.position.x, s.body.position.z, fuelTemplate);
        continue;
      }

      if (age > FUEL.shotTimeout) {
        // Timed out without landing – remove and respawn in spawn area
        scene.remove(s.mesh);
        removeShotBody(s.body);
        shots.splice(i, 1);
        const pos = randomFuelPos();
        spawnFuel(pos.x, pos.z, fuelTemplate);
        continue;
      }

      // Remove if fell way below the field
      if (s.body.position.y < -5) {
        scene.remove(s.mesh);
        removeShotBody(s.body);
        shots.splice(i, 1);
        const pos = randomFuelPos();
        spawnFuel(pos.x, pos.z, fuelTemplate);
      }
    }

    // ── Update HUD ──
    hudBalls.textContent = `${getRobotBallCount()} / ${ROBOT.maxBalls}`;
    hudShots.textContent = `${_localShotsMade}`;

    // ── Render ──
    renderer.render(scene, camera);
  }

  loop();
}

// ── Helpers ──

function spawnFuel(x, z, templateModel) {
  const mesh = templateModel.clone();
  mesh.position.set(x, 0, z);
  scene.add(mesh);

  const body = createFuelBody(x, z);
  fuels.push({ mesh, body });
}

function clearAllFuel() {
  for (const f of fuels) {
    scene.remove(f.mesh);
    removeFuelBody(f.body);
  }
  fuels.length = 0;
}

function clearAllShots() {
  for (const s of shots) {
    scene.remove(s.mesh);
    removeShotBody(s.body);
  }
  shots.length = 0;
}

// Go!
main();
