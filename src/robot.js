/**
 * robot.js – Swerve drive controller and shooting logic.
 *
 * Field-centric swerve:  WASD applies forces in the FIELD frame
 * (W = +Z toward far end, A = -X to the left from driver POV).
 * QE rotates the chassis.
 */
import * as CANNON from 'cannon-es';
import { ROBOT, SHOOTER, FUEL } from './config.js';
import { robotBody, createShotBody } from './physics.js';
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
// Robot physics sphere radius (must match physics.js)
const ROBOT_RADIUS = Math.max(ROBOT.width, ROBOT.depth) / 2;

export function resetRobot() {
  robotBody.position.set(0, ROBOT_RADIUS + 0.01, 0);
  robotBody.velocity.setZero();
  robotBody.angularVelocity.setZero();
  robotBody.quaternion.set(0, 0, 0, 1);
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
  // WASD is relative to the current camera's base viewing direction so that
  // W always pushes the robot "forward" from the driver-station perspective.
  const move = getMoveInput();
  const yaw = getCameraBaseYaw();
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);

  // forwardInput = -move.x  (W → +1 forward)
  // rightInput   =  move.z  (D → +1 right)
  const fwd = -move.x;
  const rgt =  move.z;

  // Rotate into world XZ
  const worldX = fwd * sinY - rgt * cosY;
  const worldZ = fwd * cosY + rgt * sinY;

  const targetVx = worldX * ROBOT.maxSpeed;
  const targetVz = worldZ * ROBOT.maxSpeed;

  // Smoothly interpolate toward target velocity
  const lerpRate = 1.0 - Math.exp(-ROBOT.acceleration * dt);
  robotBody.velocity.x += (targetVx - robotBody.velocity.x) * lerpRate;
  robotBody.velocity.z += (targetVz - robotBody.velocity.z) * lerpRate;

  // Let physics resolve vertical contacts with field geometry.
  // Only prevent sinking below floor plane.
  const minY = ROBOT_RADIUS + 0.01;
  if (robotBody.position.y < minY) {
    robotBody.position.y = minY;
    if (robotBody.velocity.y < 0) robotBody.velocity.y = 0;
  }

  // ── Rotation (Q/E only) ──
  const rotInput = getRotationInput();
  const targetOmega = rotInput * ROBOT.maxAngularSpeed;
  const angLerpRate = 1.0 - Math.exp(-ROBOT.angularAcceleration * dt);
  robotBody.angularVelocity.set(
    0,
    robotBody.angularVelocity.y + (targetOmega - robotBody.angularVelocity.y) * angLerpRate,
    0,
  );

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
  const intakeX = robotBody.position.x - fwd.x * (ROBOT.depth / 2 + 0.1);
  const intakeZ = robotBody.position.z - fwd.z * (ROBOT.depth / 2 + 0.1);

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

  // Launch direction = robot backward (reverse of forward)
  const fwd = _getRobotForward();
  const angleRad = (SHOOTER.launchAngle * Math.PI) / 180;

  // Reverse direction by negating fwd
  const vx = -fwd.x * SHOOTER.launchSpeed * Math.cos(angleRad);
  const vz = -fwd.z * SHOOTER.launchSpeed * Math.cos(angleRad);
  const vy = SHOOTER.launchSpeed * Math.sin(angleRad);

  const pos = new CANNON.Vec3(
    robotBody.position.x - fwd.x * (ROBOT.depth / 2 + FUEL.radius + 0.1),
    SHOOTER.launchHeight,
    robotBody.position.z - fwd.z * (ROBOT.depth / 2 + FUEL.radius + 0.1),
  );

  const body = createShotBody(pos, new CANNON.Vec3(vx, vy, vz));
  onShoot(body);
}

/**
 * Get the robot's forward direction on the XZ plane (unit vector).
 * Robot local forward is -Z in Three.js convention.
 */
function _getRobotForward() {
  const q = robotBody.quaternion;
  // Rotate local -Z by quaternion
  const localFwd = new CANNON.Vec3(0, 0, -1);
  const worldFwd = q.vmult(localFwd);
  worldFwd.y = 0;
  worldFwd.normalize();
  return worldFwd;
}
