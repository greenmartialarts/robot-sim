/**
 * scene.js – Three.js scene, renderer, lighting, and helpers.
 */
import * as THREE from 'three';
import { RENDER, FIELD } from './config.js';

/** @type {THREE.Scene} */
export let scene;

/** @type {THREE.WebGLRenderer} */
export let renderer;

/** @type {THREE.DirectionalLight | null} */
let _dirLight = null;

/** @type {THREE.Mesh | null} */
let _groundMesh = null;

export function initScene() {
  // ── Scene ──
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 30, 60);

  // ── Renderer ──
  renderer = new THREE.WebGLRenderer({
    antialias: RENDER.antialias,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
  renderer.shadowMap.enabled = RENDER.shadowsEnabled;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);

  // ── Lighting ──
  // Ambient
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  // Main directional (sun-like)
  _dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  _dirLight.position.set(10, 15, -5);
  _dirLight.castShadow = RENDER.shadowsEnabled;
  _dirLight.shadow.mapSize.setScalar(RENDER.shadowMapSize);
  _dirLight.shadow.camera.left = -FIELD.length / 2 - 2;
  _dirLight.shadow.camera.right = FIELD.length / 2 + 2;
  _dirLight.shadow.camera.top = FIELD.width / 2 + 2;
  _dirLight.shadow.camera.bottom = -(FIELD.width / 2 + 2);
  _dirLight.shadow.camera.near = 0.5;
  _dirLight.shadow.camera.far = 40;
  scene.add(_dirLight);

  // Fill light
  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.4);
  fillLight.position.set(-8, 8, 8);
  scene.add(fillLight);

  // ── Fallback ground plane (in case field model doesn't cover it) ──
  const groundGeo = new THREE.PlaneGeometry(FIELD.length + 4, FIELD.width + 4);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.9,
    metalness: 0.0,
  });
  _groundMesh = new THREE.Mesh(groundGeo, groundMat);
  _groundMesh.rotation.x = -Math.PI / 2;
  _groundMesh.position.y = -0.01; // slightly below models
  _groundMesh.receiveShadow = RENDER.shadowsEnabled;
  scene.add(_groundMesh);

  // ── Handle resize ──
  window.addEventListener('resize', onResize);
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * Apply render-related performance settings at runtime.
 */
export function applyRenderSettings() {
  if (!renderer || !scene) return;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
  renderer.shadowMap.enabled = RENDER.shadowsEnabled;

  if (_dirLight) {
    _dirLight.castShadow = RENDER.shadowsEnabled;
    _dirLight.shadow.mapSize.setScalar(RENDER.shadowMapSize);
    _dirLight.shadow.needsUpdate = true;
  }

  if (_groundMesh) {
    _groundMesh.receiveShadow = RENDER.shadowsEnabled;
  }

  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = RENDER.shadowsEnabled;
    obj.receiveShadow = RENDER.shadowsEnabled;
  });
}

/**
 * Create a simple ball mesh for fuel.
 */
export function createBallMesh(radius, color = 0xff6600) {
  const geo = new THREE.SphereGeometry(radius, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = RENDER.shadowsEnabled;
  mesh.receiveShadow = RENDER.shadowsEnabled;
  return mesh;
}
