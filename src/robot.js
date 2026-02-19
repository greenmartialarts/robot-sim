/**
 * robot.js – Swerve drive controller and shooting logic.
 *
 * Field-centric swerve:  WASD applies forces in the FIELD frame
 * (W = +Z toward far end, A = -X to the left from driver POV).
 * QE rotates the chassis.
 */
import { ROBOT, SHOOTER, FUEL } from './config.js';
import { robotBody, createShotBody, getRobotColliderBottomDistance, getRobotColliderFrontDistance } from './physics.js';
import { getMoveInput, getRotationInput, consumeShoot } from './input.js';
import { getCameraBaseYaw } from './camera.js';

// ── State ──
export let ballCount = 0;
export let shotsMade = 0;

/** Returns current ball count (use this from other modules for live values). */
export function getRobotBallCount() { return ballCount; }

let _lastShotTime = 0;

/**
 * Reset robot position and state.
 */
export function resetRobot() {
  robotBody.setTranslation({ x: 0, y: getRobotColliderBottomDistance() + 0.01, z: 0 }, true);
  robotBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  robotBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  robotBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  robotBody.wakeUp();
  ballCount = 0;
}

/**
 * Update swerve drive forces and shooting each frame.
 * @param {number} dt – delta time in seconds
 * @param {THREE.Object3D[]} fuelMeshes – live fuel meshes in scene
 * @param {Function} onPickup – callback(fuelIndex)
 * @param {Function} onShoot – callback(shotBody)
 */
export function updateRobot(dt, fuelMeshes, onPickup, onShoot) {
  // Wake up the body every frame so physics never sleeps on us
  robotBody.wakeUp();

  // ── Translation (camera-relative) ──
  // WASD is relative to the current camera’s base viewing direction so that
  // W always pushes the robot “forward” from the driver-station perspective.
  const move = getMoveInput();
  const yaw = getCameraBaseYaw();
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);

  // forwardInput = -move.x  (W → +1 forward)
  // rightInput   =  move.z  (D → +1 right)
  const fwdInput = -move.x;
  const rgtInput =  move.z;

  // Rotate into world XZ
  const worldX = fwdInput * sinY - rgtInput * cosY;
  const worldZ = fwdInput * cosY + rgtInput * sinY;

  const targetVx = worldX * ROBOT.maxSpeed;
  const targetVz = worldZ * ROBOT.maxSpeed;

  // Smoothly interpolate toward target velocity
  const lerpRate = 1.0 - Math.exp(-ROBOT.acceleration * dt);
  const vel = robotBody.linvel();
  robotBody.setLinvel({
    x: vel.x + (targetVx - vel.x) * lerpRate,
    y: vel.y,
    z: vel.z + (targetVz - vel.z) * lerpRate,
  }, true);

  // Let physics resolve vertical contacts with field geometry.
  // Only prevent sinking below floor plane as a safety net.
  const minY = getRobotColliderBottomDistance() + 0.01;
  const pos = robotBody.translation();
  if (pos.y < minY) {
    robotBody.setTranslation({ x: pos.x, y: minY, z: pos.z }, true);
    const v2 = robotBody.linvel();
    if (v2.y < 0) robotBody.setLinvel({ x: v2.x, y: 0, z: v2.z }, true);
  }

  // ── Rotation (Q/E only) ──
  const rotInput = getRotationInput();
  const targetOmega = rotInput * ROBOT.maxAngularSpeed;
  const angLerpRate = 1.0 - Math.exp(-ROBOT.angularAcceleration * dt);
  const av = robotBody.angvel();
  robotBody.setAngvel({
    x: 0,
    y: av.y + (targetOmega - av.y) * angLerpRate,
    z: 0,
  }, true);

  // ── Pickup logic ──
  _handlePickup(fuelMeshes, onPickup);

  // ── Shooting ──
  _handleShoot(onShoot);
}

// ── Internal helpers ──

function _handlePickup(fuelMeshes, onPickup) {
  if (ballCount >= ROBOT.maxBalls) return;

  // Robot "intake" position: front of robot in local space
  const fwd = _getRobotForward();
  const frontDist = getRobotColliderFrontDistance();
  const rpos = robotBody.translation();
  const intakeX = rpos.x - fwd.x * (frontDist + 0.1);
  const intakeZ = rpos.z - fwd.z * (frontDist + 0.1);

  for (let i = fuelMeshes.length - 1; i >= 0; i--) {
    const m = fuelMeshes[i];
    const dx = m.position.x - intakeX;
    const dz = m.position.z - intakeZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < FUEL.pickupRadius) {
      ballCount++;
      onPickup(i);
      break; // one per frame
    }
  }
}

function _handleShoot(onShoot) {
  if (!consumeShoot()) return;
  if (ballCount <= 0) return;

  const now = performance.now();
  if (now - _lastShotTime < SHOOTER.cooldownMs) return;
  _lastShotTime = now;

  ballCount--;

  // Rotate the intake forward by shooterYawOffsetDeg to get shoot direction
  let fwd = _getRobotForward();
  const shootYawRad = (SHOOTER.shooterYawOffsetDeg * Math.PI) / 180;
  const cosS = Math.cos(shootYawRad);
  const sinS = Math.sin(shootYawRad);
  const sfx = fwd.x * cosS - fwd.z * sinS;
  const sfz = fwd.x * sinS + fwd.z * cosS;
  fwd = { x: sfx, y: 0, z: sfz };

  const angleRad = (SHOOTER.launchAngle * Math.PI) / 180;

  // Launch direction = shooter forward
  const vx = fwd.x * SHOOTER.launchSpeed * Math.cos(angleRad);
  const vz = fwd.z * SHOOTER.launchSpeed * Math.cos(angleRad);
  const vy = SHOOTER.launchSpeed * Math.sin(angleRad);

  const frontDist = getRobotColliderFrontDistance();
  const spos = robotBody.translation();
  const shotPos = {
    x: spos.x + fwd.x * (frontDist + FUEL.radius + 0.1),
    y: SHOOTER.launchHeight,
    z: spos.z + fwd.z * (frontDist + FUEL.radius + 0.1),
  };

  const body = createShotBody(shotPos, { x: vx, y: vy, z: vz });
  onShoot(body);
}

/**
 * Rotate a vector by a quaternion (q * v).
 * @param {{ x, y, z, w }} q
 * @param {{ x, y, z }} v
 * @returns {{ x, y, z }}
 */
function _quatVmult(q, v) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const { x: vx, y: vy, z: vz } = v;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return {
    x: vx + qw * tx + (qy * tz - qz * ty),
    y: vy + qw * ty + (qz * tx - qx * tz),
    z: vz + qw * tz + (qx * ty - qy * tx),
  };
}

/**
 * Get the robot's forward direction on the XZ plane (unit vector).
 * Robot local forward is -Z in Three.js convention.
 */
function _getRobotForward() {
  const q = robotBody.rotation(); // { x, y, z, w }
  // Rotate local -Z by quaternion
  const worldFwd = _quatVmult(q, { x: 0, y: 0, z: -1 });
  worldFwd.y = 0;
  const len0 = Math.sqrt(worldFwd.x * worldFwd.x + worldFwd.z * worldFwd.z);
  if (len0 > 0) { worldFwd.x /= len0; worldFwd.z /= len0; }

  const yawOffsetRad = (ROBOT.intakeYawOffsetDeg * Math.PI) / 180;
  const cosA = Math.cos(yawOffsetRad);
  const sinA = Math.sin(yawOffsetRad);
  const x = worldFwd.x;
  const z = worldFwd.z;
  worldFwd.x = x * cosA - z * sinA;
  worldFwd.z = x * sinA + z * cosA;
  const len1 = Math.sqrt(worldFwd.x * worldFwd.x + worldFwd.z * worldFwd.z);
  if (len1 > 0) { worldFwd.x /= len1; worldFwd.z /= len1; }
  return worldFwd;
}
