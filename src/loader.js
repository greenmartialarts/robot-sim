/**
 * loader.js – Asset loading utilities for FBX models.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const loader = new FBXLoader();

/**
 * Load an FBX model from `url`.
 * @param {string} url
 * @param {(progress: number) => void} onProgress  – 0‒1 fraction
 * @returns {Promise<THREE.Group>}
 */
export function loadFBX(url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (object) => resolve(object),
      (xhr) => {
        if (xhr.lengthComputable && onProgress) {
          onProgress(xhr.loaded / xhr.total);
        }
      },
      (err) => reject(err),
    );
  });
}

/**
 * Auto-scale a loaded model so its largest axis matches `targetSize` metres.
 */
export function normalizeModel(object, targetSize) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim === 0) return;
  const scale = targetSize / maxDim;
  object.scale.multiplyScalar(scale);
}

/**
 * Centre an object's bounding box on the XZ plane, bottom at y = 0.
 */
export function groundModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  box.getCenter(center);
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y; // bottom sits on y = 0
}

/**
 * Enable shadow casting / receiving on all meshes within an object.
 */
export function enableShadows(object, cast = true, receive = true) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}
