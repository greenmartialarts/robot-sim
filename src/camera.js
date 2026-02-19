/**
 * camera.js – Multi-view camera with mouse-look (pointer lock).
 */
import * as THREE from 'three';
import { CAMERAS } from './config.js';

/** @type {THREE.PerspectiveCamera} */
export let camera;

let _currentIndex = 0;

// Base yaw from position → lookAt (does NOT include mouse deltas)
let _baseYaw = 0;

// Spherical angles for mouse-look (yaw / pitch)
let _yaw = 0;
let _pitch = 0;
const SENSITIVITY = 0.002;

let _isPointerLocked = false;

export function initCamera() {
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );

  _setCameraView(0);

  // Pointer-lock for mouse look
  const canvas = document.querySelector('canvas');
  if (canvas) {
    canvas.addEventListener('click', () => {
      canvas.requestPointerLock();
    });
  }

  document.addEventListener('pointerlockchange', () => {
    _isPointerLocked = !!document.pointerLockElement;
  });

  document.addEventListener('mousemove', (e) => {
    if (!_isPointerLocked) return;
    // Only allow mouse-look if the current camera has it enabled
    const cfg = CAMERAS[_currentIndex];
    if (!cfg.mouseLook) return;
    _yaw -= e.movementX * SENSITIVITY;
    _pitch -= e.movementY * SENSITIVITY;
    _pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, _pitch));
    _applyRotation();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });
}

/**
 * Switch to a specific camera view (1-based index from user input).
 * Returns true if the view changed.
 */
export function switchCamera(index1Based) {
  const idx = index1Based - 1;
  if (idx < 0 || idx >= CAMERAS.length || idx === _currentIndex) return false;
  _setCameraView(idx);
  return true;
}

/**
 * Returns the base yaw of the current camera view (position → lookAt)
 * on the XZ plane. Used by robot.js to orient WASD relative to the
 * driver-station perspective.
 */
export function getCameraBaseYaw() {
  return _baseYaw;
}

/**
 * Call once per frame – returns the camera label.
 */
export function updateCamera() {
  return CAMERAS[_currentIndex].label;
}

/** Returns the 0-based index of the active camera (matches CAMERAS array). */
export function getCurrentCameraIndex() {
  return _currentIndex;
}

/* ── Internal helpers ── */

function _setCameraView(idx) {
  _currentIndex = idx;
  const cfg = CAMERAS[idx];
  camera.position.set(...cfg.position);

  // Compute initial yaw/pitch from the lookAt direction
  const dir = new THREE.Vector3(...cfg.lookAt)
    .sub(new THREE.Vector3(...cfg.position))
    .normalize();
  _baseYaw = Math.atan2(dir.x, dir.z);
  _yaw = _baseYaw;
  _pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));

  _applyRotation();
}

function _applyRotation() {
  // Build a direction vector from spherical yaw/pitch
  const dir = new THREE.Vector3(
    Math.sin(_yaw) * Math.cos(_pitch),
    Math.sin(_pitch),
    Math.cos(_yaw) * Math.cos(_pitch),
  );
  const target = new THREE.Vector3().copy(camera.position).add(dir);
  camera.lookAt(target);
}
