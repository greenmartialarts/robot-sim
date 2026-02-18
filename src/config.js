/**
 * config.js – All tunable simulation parameters in one place.
 */

import { label } from "three/tsl";

// ── Field dimensions (metres, approximate FRC field) ──
export const FIELD = {
  length: 16.46,   // ~54 ft
  width: 8.23,     // ~27 ft
};

// ── Robot parameters ──
export const ROBOT = {
  maxSpeed: 5.0,          // m/s max translational speed
  maxAngularSpeed: 8.0,    // rad/s max rotational speed
  acceleration: 10.0,      // m/s² translational acceleration
  angularAcceleration: 50,  // rad/s² angular acceleration
  drag: 10.0,               // linear drag coefficient
  angularDrag: 4.0,        // angular drag coefficient
  mass: 56,                // kg (~125 lbs)
  maxBalls: 10,            // max fuel the robot can hold
  // Approximate bounding box for physics (metres)
  width: 0.84,            // ~33 in frame
  depth: 0.84,
  height: 0.3,
  // Intake zone: forward-facing front of robot (local +Z by convention after alignment)
  intakeReach: 0.6,       // how far in front the intake extends
};

// ── Shooter parameters (tune these!) ──
export const SHOOTER = {
  launchSpeed: 6.0,      // m/s muzzle speed
  launchAngle: 60,        // degrees from horizontal
  launchHeight: 0.6,      // metres above ground the ball exits
  cooldownMs: 100,        // minimum time between shots
};

// ── Fuel (ball) parameters ──
export const FUEL = {
  radius: 0.12,           // ~5 in diameter ball
  mass: 0.3,              // kg
  pickupRadius: 0.8,      // how close to pick up
  totalBalls: 20,         // number of balls on the field
  // Spawn area bounds
  spawnArea: {
    xMin: -0.5, xMax: 0.5,
    zMin: -1.5, zMax: 1.5,
  },
  shotTimeout: 2000,     // ms – if shot ball doesn't land in this time, respawn it
};

// ── Field perimeter bounds (half-lengths for out-of-bounds checks) ──
export const FIELD_BOUNDS = {
  xHalf: FIELD.length / 2 + 0.5,   // slight margin
  zHalf: FIELD.width / 2 + 0.5,
};

// ── Camera / driver station positions ──
export const CAMERAS = [    
  {
    label: '1 – Blue 1 Driver Station',
    position: [FIELD.length / 2.4, 1, 2.2],
    lookAt: [-FIELD.length / 2.4, 1, 2.2],
    mouseLook: true,
  }, 
  {
    label: '2 – Blue 2 Driver Station',
    position: [FIELD.length / 2.4, 1, 0.9],
    lookAt: [-FIELD.length / 2.4, 1, 0.9],
    mouseLook: true,
  },
  {
    label: '3 – Blue 1 Driver Station',
    position: [FIELD.length / 2.4, 1, -1.35],
    lookAt: [-FIELD.length / 2.4, 1, -1.35],
    mouseLook: true,
  },
  {
    label: '4 – Red 1 Driver Station',
    position: [-FIELD.length / 2.4, 1, -2.2],
    lookAt: [FIELD.length / 2.4, 1, -2.2],
    mouseLook: true,
  },
  {
    label: '5 – Red 2 Driver Station',
    position: [-FIELD.length / 2.4, 1, -0.85],
    lookAt: [FIELD.length / 2.4, 1, -0.85],
    mouseLook: true,
  },
  {
    label: '6 – Red 3 Driver Station',
    position: [-FIELD.length / 2.4, 1, 1.35],
    lookAt: [FIELD.length / 2.4, 1, 1.35],
    mouseLook: true,
  },
  {
    label: '7 – Overhead',
    position: [0, 12, 0],
    lookAt: [0, 0, 0],
    mouseLook: false,
  },
  {
    label: '8 – Side View',
    position: [0, 2, FIELD.width / 2 + 2],
    lookAt: [0, 0, 0],
    mouseLook: true,
  },
];

// ── Physics ──
export const PHYSICS = {
  gravity: -9.81,
  fixedTimeStep: 1 / 120,
  maxSubSteps: 3,
};

// ── Rendering ──
export const RENDER = {
  antialias: true,
  shadowMapSize: 1024,
  maxPixelRatio: 2,
};
