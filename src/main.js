/**
 * main.js – Entry point for the FRC Swerve Robot Simulation.
 *
 * Orchestrates loading, scene setup, physics, 3D model placement,
 * the game loop, and the UI overlay.
 */
import * as THREE from 'three';
import { FUEL, ROBOT, FIELD, FIELD_BOUNDS, PHYSICS, RENDER } from './config.js';
import { initScene, scene, renderer, createBallMesh, applyRenderSettings } from './scene.js';
import { initCamera, camera, updateCamera, switchCamera, getCurrentCameraIndex } from './camera.js';
import { initInput, consumeReset, consumeCameraSwitch } from './input.js';
import {
  initPhysics,
  stepPhysics,
  robotBody,
  getRobotColliderBottomDistance,
  createFuelBody,
  removeFuelBody,
  removeShotBody,
  addFieldColliders,
  addRobotCollider,
  getAllTrackedColliders,
  getColliderMeta,
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
const perfPreset = document.getElementById('perf-preset');
const perfPixelRatio = document.getElementById('perf-pixel-ratio');
const perfShadows = document.getElementById('perf-shadows');
const perfHitboxes = document.getElementById('perf-hitboxes');
const perfShadowSize = document.getElementById('perf-shadow-size');
const perfPhysicsHz = document.getElementById('perf-physics-hz');
const perfSubsteps = document.getElementById('perf-substeps');

// ── Live object tracking ──
let robotMesh = null;

/** @type {{ mesh: THREE.Object3D, body: import('cannon-es').Body }[]} */
const fuels = [];

/** @type {{ mesh: THREE.Object3D, body: import('cannon-es').Body, spawnTime: number }[]} */
const shots = [];

// Track shots made locally (robot.js exports aren't live references for primitives)
let _localShotsMade = 0;

let _hitboxDebugEnabled = false;
let _hitboxGroup = null;
const _bodyDebugMeshes = new Map();

// ── Mini-map state ────────────────────────────────────────────────────────
// Fixed CSS dimensions for the minimap viewport (field is ~2:1)
const _MM_CSS_W = 440;
const _MM_CSS_H = 220;
const _mmFrameEl = document.getElementById('minimap');
/** @type {THREE.OrthographicCamera | null} */
let _mmOrthoCamera = null;

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
  camera.layers.enable(1); // layer 1 = fuel/shots, visible to main camera only
  initInput();
  await initPhysics();

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
      loadFBX('/Robotv2.fbx', (p) => { progress.robot = p; updateLoadingBar(); }),
      loadFBX('/Fuel.fbx', (p) => { progress.fuel = p; updateLoadingBar(); }),
    ]);
  } catch (err) {
    loadingText.textContent = `Error loading models: ${err.message}`;
    console.error(err);
    return;
  }

  _initPerformancePanel();

  loadingText.textContent = 'Setting up scene...';

  // ── Field ──
  normalizeModel(fieldModel, FIELD.length);
  groundModel(fieldModel);
  enableShadows(fieldModel, false, true);
  scene.add(fieldModel);

  // Build physics colliders from the field geometry (trimesh for both fuel and robot).
  fieldModel.updateMatrixWorld(true);
  addFieldColliders(fieldModel);
  PHYSICS.useFieldTrimesh = true;

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
  //robotPivot.rotation.z = Math.PI / 2;

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

  // Build convex-hull collider from the actual robot mesh geometry.
  // Rapier supports ConvexPolyhedron vs Trimesh natively, so the robot
  // will now physically interact with the field mesh colliders.
  await addRobotCollider(robotPivot);

  // ── Minimap orthographic camera ──
  // Looks straight down; only sees layer 0 (field + robot, no fuel).
  // Main camera has layer 1 enabled so it sees fuel and shot balls.
  {
    const hl = FIELD.length / 2;
    const hw = FIELD.width  / 2;
    _mmOrthoCamera = new THREE.OrthographicCamera(-hl, hl, hw, -hw, 1, 200);
    // up = (0,0,-1) so world +X → screen right, world -Z → screen top
    _mmOrthoCamera.up.set(0, 0, -1);
    _mmOrthoCamera.position.set(0, 100, 0);
    _mmOrthoCamera.lookAt(0, 0, 0);
    _mmOrthoCamera.layers.set(0); // layer 0 only – no fuel/shots
  }

  _hookPerformanceEvents(fieldModel);

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
  // Fuel is on layer 1 so the minimap ortho camera (layer 0 only) hides them
  fuelTemplate.traverse((child) => child.layers.set(1));

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
        ballMesh.layers.set(1); // hide from minimap ortho camera
        scene.add(ballMesh);
        shots.push({ mesh: ballMesh, body: shotBody, spawnTime: performance.now() });
        _localShotsMade++;
      },
    );

    // Step physics
    stepPhysics(dt);

    if (_hitboxDebugEnabled) {
      _syncHitboxDebugMeshes();
    }

    // ── Sync Three.js transforms with Rapier ──
    // Robot body origin is at bottom-distance above the ground.
    // Visual container has model bottom at local y=0, so offset by bottom-distance.
    const robotBottom = getRobotColliderBottomDistance();
    const rbt = robotBody.translation();
    const rbr = robotBody.rotation();
    robotMesh.position.set(rbt.x, rbt.y - robotBottom, rbt.z);
    robotMesh.quaternion.set(rbr.x, rbr.y, rbr.z, rbr.w);

    // Fuel – container inner model bottom is at local y=0;
    // physics sphere center is at radius above ground.
    // Also check out-of-bounds and respawn.
    for (let i = fuels.length - 1; i >= 0; i--) {
      const f = fuels[i];
      const ft = f.body.translation();
      f.mesh.position.set(ft.x, ft.y - FUEL.radius, ft.z);

      // Out-of-bounds or fell off field → respawn
      const oob =
        Math.abs(ft.x) > FIELD_BOUNDS.xHalf ||
        Math.abs(ft.z) > FIELD_BOUNDS.zHalf ||
        ft.y < -2;
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
      const st = s.body.translation();
      s.mesh.position.set(st.x, st.y, st.z);

      const age = performance.now() - s.spawnTime;
      const onGround = st.y <= FUEL.radius + 0.05;

      if (onGround && !s.landed) {
        // Ball has touched the ground – convert it back to a pickupable fuel ball
        s.landed = true;
        scene.remove(s.mesh);
        removeShotBody(s.body);
        shots.splice(i, 1);
        // Spawn a new fuel at the landing spot
        spawnFuel(st.x, st.z, fuelTemplate);
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
      if (st.y < -5) {
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
    _renderMinimap();
  }

  loop();
}

// ── Helpers ──

/**
 * Render the minimap as a top-down Three.js ortho view in a scissored sub-viewport.
 * Shown only for driver-station cameras 1–6 (indices 0–5).
 * Field + robot are rendered; fuel/shots are on layer 1 and excluded.
 */
function _renderMinimap() {
  if (!_mmOrthoCamera) return;

  const camIdx = getCurrentCameraIndex();
  _mmFrameEl.style.display = (camIdx <= 5) ? 'block' : 'none';
  if (camIdx > 5) return;

  // Viewport position (Three.js uses bottom-left origin, matching CSS `bottom:`)
  const mmX = Math.floor((window.innerWidth - _MM_CSS_W) / 7 * 5);
  const mmY = 16;

  // Snapshot clear color so we can restore it after
  const prevColor = new THREE.Color();
  renderer.getClearColor(prevColor);
  const prevAlpha = renderer.getClearAlpha();

  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setScissor(mmX, mmY, _MM_CSS_W, _MM_CSS_H);
  renderer.setViewport(mmX, mmY, _MM_CSS_W, _MM_CSS_H);

  // Clear only the minimap region to a dark background
  renderer.setClearColor(0x0a160a, 1);
  renderer.clear(true, true, false);

  // Disable fog so the top-down ortho camera (y=100) isn't fogged out
  const prevFog = scene.fog;
  scene.fog = null;
  renderer.render(scene, _mmOrthoCamera);
  scene.fog = prevFog;

  // Restore full viewport + renderer state
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.autoClear = true;
}

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

function _initPerformancePanel() {
  perfPixelRatio.value = String(RENDER.maxPixelRatio);
  perfShadows.checked = !!RENDER.shadowsEnabled;
  perfHitboxes.checked = false;
  perfShadowSize.value = String(RENDER.shadowMapSize);
  perfPhysicsHz.value = String(Math.round(1 / PHYSICS.fixedTimeStep));
  perfSubsteps.value = String(PHYSICS.maxSubSteps);
  perfPreset.value = 'fast';

  const panel = document.getElementById('perf-panel');
  const btn = document.getElementById('perf-toggle');
  const title = document.getElementById('perf-title');
  const toggle = () => {
    panel.classList.toggle('collapsed');
    btn.innerHTML = panel.classList.contains('collapsed') ? '&#x2b;' : '&#x2212;';
    btn.title = panel.classList.contains('collapsed') ? 'Expand' : 'Minimize';
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  title.addEventListener('click', toggle);
}

function _hookPerformanceEvents(fieldModel) {
  const applyFromControls = () => {
    RENDER.maxPixelRatio = Number(perfPixelRatio.value);
    RENDER.shadowsEnabled = perfShadows.checked;
    RENDER.shadowMapSize = Number(perfShadowSize.value);

    // Keep field as trimesh colliders (Rapier supports robot convex hull vs trimesh natively).
    fieldModel.updateMatrixWorld(true);
    addFieldColliders(fieldModel);
    PHYSICS.useFieldTrimesh = true;

    const hz = Number(perfPhysicsHz.value);
    PHYSICS.fixedTimeStep = 1 / hz;
    PHYSICS.maxSubSteps = Number(perfSubsteps.value);

    applyRenderSettings();

    _setHitboxDebugEnabled(perfHitboxes.checked);
  };

  const applyPreset = (preset) => {
    if (preset === 'fast') {
      perfPixelRatio.value = '1';
      perfShadows.checked = false;
      perfHitboxes.checked = false;
      perfShadowSize.value = '512';
      perfPhysicsHz.value = '60';
      perfSubsteps.value = '1';
      
    } else if (preset === 'balanced') {
      perfPixelRatio.value = '1.25';
      perfShadows.checked = false;
      perfHitboxes.checked = false;
      perfShadowSize.value = '1024';
      perfPhysicsHz.value = '60';
      perfSubsteps.value = '2';
      
    } else {
      perfPixelRatio.value = '2';
      perfShadows.checked = true;
      perfHitboxes.checked = false;
      perfShadowSize.value = '2048';
      perfPhysicsHz.value = '120';
      perfSubsteps.value = '3';
      
    }

    applyFromControls();
  };

  perfPreset.addEventListener('change', () => {
    applyPreset(perfPreset.value);
  });

  [
    perfPixelRatio,
    perfShadows,
    perfHitboxes,
    perfShadowSize,
    perfPhysicsHz,
    perfSubsteps,
  ]
    .forEach((el) => el.addEventListener('change', applyFromControls));

  applyFromControls();
}

function _setHitboxDebugEnabled(enabled) {
  if (_hitboxDebugEnabled === enabled) return;
  _hitboxDebugEnabled = enabled;

  if (enabled) {
    if (!_hitboxGroup) {
      _hitboxGroup = new THREE.Group();
      _hitboxGroup.name = 'hitbox-debug-group';
      scene.add(_hitboxGroup);
    }
    _syncHitboxDebugMeshes();
    return;
  }

  if (_hitboxGroup) {
    scene.remove(_hitboxGroup);
    _hitboxGroup.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
  }

  _hitboxGroup = null;
  _bodyDebugMeshes.clear();
}

function _syncHitboxDebugMeshes() {
  if (!_hitboxGroup) return;

  const currentColliders = getAllTrackedColliders();
  const currentHandles = new Set(currentColliders.map((c) => c.handle));

  for (const collider of currentColliders) {
    let mesh = _bodyDebugMeshes.get(collider.handle);
    if (!mesh) {
      const meta = getColliderMeta(collider);
      mesh = _createColliderDebugMesh(meta);
      _bodyDebugMeshes.set(collider.handle, mesh);
      _hitboxGroup.add(mesh);
    }
    const t = collider.translation();
    const r = collider.rotation();
    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  for (const [handle, mesh] of _bodyDebugMeshes) {
    if (currentHandles.has(handle)) continue;
    _hitboxGroup.remove(mesh);
    mesh.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    _bodyDebugMeshes.delete(handle);
  }
}

/**
 * Build a Three.js wireframe group for a tracked collider using its shape metadata.
 * @param {object | undefined} meta
 */
function _createColliderDebugMesh(meta) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x00ff66,
    wireframe: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });

  const geometry = _createColliderGeometry(meta);
  if (geometry) {
    group.add(new THREE.Mesh(geometry, material));
  }
  return group;
}

function _createColliderGeometry(meta) {
  if (!meta) return null;

  switch (meta.type) {
    case 'ball':
      return new THREE.SphereGeometry(meta.radius, 16, 12);

    case 'box': {
      const g = new THREE.BoxGeometry(meta.hx * 2, meta.hy * 2, meta.hz * 2);
      g.translate(meta.tx ?? 0, meta.ty ?? 0, meta.tz ?? 0);
      return g;
    }

    case 'groundbox': {
      // Render a modest-sized floor quad instead of the full 400m slab
      const g = new THREE.BoxGeometry(FIELD.length + 4, 0.02, FIELD.width + 4);
      return g;
    }

    case 'trimesh': {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(meta.verts, 3));
      g.setIndex(Array.from(meta.indices));
      g.computeVertexNormals();
      return g;
    }

    case 'convex': {
      // Derive AABB from hull verts as a reasonable debug approximation
      const v = meta.verts;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < v.length; i += 3) {
        if (v[i]   < minX) minX = v[i];   if (v[i]   > maxX) maxX = v[i];
        if (v[i+1] < minY) minY = v[i+1]; if (v[i+1] > maxY) maxY = v[i+1];
        if (v[i+2] < minZ) minZ = v[i+2]; if (v[i+2] > maxZ) maxZ = v[i+2];
      }
      const g = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
      g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      return g;
    }

    default:
      return null;
  }
}

// Go!
main();
