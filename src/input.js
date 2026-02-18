/**
 * input.js – Keyboard + gamepad input manager.
 *
 * Tracks keyboard keys and gamepad axes/buttons, and provides
 * merged helpers for movement, rotation, and actions.
 */

const _keys = {};
let _shootPressed = false;
let _resetPressed = false;
let _cameraSwitch = 0; // 0 = none, 1-8 = camera index

const GAMEPAD_DEADZONE = 0.15;
let _prevGamepadShootPressed = false;

function _onKeyDown(e) {
  _keys[e.code] = true;

  if (e.code === 'Space') {
    e.preventDefault();
    _shootPressed = true;
  }
  if (e.code === 'KeyR') _resetPressed = true;

  // Camera switching: 1-4
  if (e.code === 'Digit1') _cameraSwitch = 1;
  if (e.code === 'Digit2') _cameraSwitch = 2;
  if (e.code === 'Digit3') _cameraSwitch = 3;
  if (e.code === 'Digit4') _cameraSwitch = 4;
  if (e.code === 'Digit5') _cameraSwitch = 5;
  if (e.code === 'Digit6') _cameraSwitch = 6;
  if (e.code === 'Digit7') _cameraSwitch = 7;
  if (e.code === 'Digit8') _cameraSwitch = 8;
}

function _onKeyUp(e) {
  _keys[e.code] = false;
}

export function initInput() {
  window.addEventListener('keydown', _onKeyDown);
  window.addEventListener('keyup', _onKeyUp);
}

/** Returns { x, z } in range [-1, 1] for translational input (field frame). */
export function getMoveInput() {
  let x = 0;
  let z = 0;

  // Keyboard
  if (_keys['KeyW'] || _keys['ArrowUp']) x -= 1;
  if (_keys['KeyS'] || _keys['ArrowDown']) x += 1;
  if (_keys['KeyA'] || _keys['ArrowLeft']) z -= 1;
  if (_keys['KeyD'] || _keys['ArrowRight']) z += 1;

  // Gamepad (left stick): axis 1 = forward/back, axis 0 = strafe
  const gp = _readGamepadInput();
  x += gp.moveX;
  z += gp.moveZ;

  // Normalize diagonal
  const len = Math.sqrt(x * x + z * z);
  if (len > 1) { x /= len; z /= len; }
  return { x, z };
}

/** Returns rotation input in range [-1, 1] (positive = counter-clockwise). */
export function getRotationInput() {
  let r = 0;

  // Keyboard
  if (_keys['KeyQ']) r += 1;
  if (_keys['KeyE']) r -= 1;

  // Gamepad (right stick X)
  const gp = _readGamepadInput();
  r += gp.rotation;

  // Clamp to expected range
  if (r > 1) r = 1;
  if (r < -1) r = -1;
  return r;
}

/** Consumes the shoot flag (returns true once per press). */
export function consumeShoot() {
  const gp = _readGamepadInput();
  const gamepadShootRisingEdge = gp.shootPressed && !_prevGamepadShootPressed;
  _prevGamepadShootPressed = gp.shootPressed;

  if (gamepadShootRisingEdge) {
    _shootPressed = true;
  }

  if (_shootPressed) { _shootPressed = false; return true; }
  return false;
}

/** Consumes the reset flag. */
export function consumeReset() {
  if (_resetPressed) { _resetPressed = false; return true; }
  return false;
}

/** Consumes camera switch (returns 0 if none, else 1-3). */
export function consumeCameraSwitch() {
  const v = _cameraSwitch;
  _cameraSwitch = 0;
  return v;
}

function _readGamepadInput() {
  const result = {
    moveX: 0,
    moveZ: 0,
    rotation: 0,
    shootPressed: false,
  };

  if (!navigator.getGamepads) return result;

  const gamepads = navigator.getGamepads();
  for (const gp of gamepads) {
    if (!gp) continue;

    // Standard mapping: left stick [0,1], right stick X [2], primary action button [0]
    const leftX = _applyDeadzone(gp.axes?.[0] ?? 0);
    const leftY = _applyDeadzone(gp.axes?.[1] ?? 0);
    const rightX = _applyDeadzone(gp.axes?.[2] ?? 0);

    // Keep same sign convention used by keyboard mapping
    result.moveX += leftY;      // up stick (-1) => forward (x -= 1)
    result.moveZ += leftX;      // right stick (+1) => strafe right (z += 1)
    result.rotation += -rightX; // right stick right => clockwise (same as KeyE)

    if (gp.buttons?.[0]?.pressed) {
      result.shootPressed = true;
    }
  }

  if (result.rotation > 1) result.rotation = 1;
  if (result.rotation < -1) result.rotation = -1;

  return result;
}

function _applyDeadzone(value) {
  return Math.abs(value) < GAMEPAD_DEADZONE ? 0 : value;
}
