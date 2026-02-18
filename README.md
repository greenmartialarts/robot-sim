# FRC Swerve Robot Simulation

A web-based, driver-station POV simulation for the 2026 FRC season featuring a swerve-drive robot. Built with **Three.js** (3D rendering) and **Cannon-es** (physics).

## Quick Start

```bash
npm install
npm run dev
```

The simulation opens automatically in your default browser.

## Controls

| Key | Action |
|---|---|
| `W` / `A` / `S` / `D` | Field-centric translation (forward / left / back / right) |
| `Q` / `E` | Rotate robot (counter-clockwise / clockwise) |
| `Space` | Shoot fuel ball |
| `1` / `2` / `3` | Switch driver station camera |
| `R` | Reset robot & fuel |

## Project Structure

```
├── index.html          Entry point
├── src/
│   ├── main.js         Game loop, model loading, orchestration
│   ├── config.js       All tunable parameters (speeds, physics, cameras)
│   ├── input.js        Keyboard state manager
│   ├── scene.js        Three.js scene, renderer, lighting
│   ├── camera.js       3-position driver station camera system
│   ├── physics.js      Cannon-es world, bodies, walls
│   ├── robot.js        Swerve drive logic, pickup & shooting
│   └── loader.js       FBX model loading utilities
├── field-2026.fbx      Field model
├── Robot.fbx           Robot model
├── Fuel.fbx            Fuel (ball) model
├── vite.config.js      Vite bundler config
└── package.json
```

## Configuration

All tunable parameters live in [`src/config.js`](src/config.js):

- **Robot** – max speed, acceleration, drag, dimensions, mass
- **Shooter** – launch speed, angle, height, cooldown
- **Fuel** – spawn positions, pickup radius
- **Cameras** – three driver station positions & targets
- **Physics** – gravity, timestep, substeps

## Features

- **Field-centric swerve drive** – WASD always maps to field directions regardless of robot heading
- **Three camera positions** – configurable driver station viewpoints
- **Fuel pickup** – drive into fuel balls to collect (max 1)
- **Shooting** – launch balls with configurable angle & speed
- **HUD overlay** – displays fuel count and shots made
- **Physics simulation** – realistic collisions via Cannon-es
- **FBX model support** – loads provided field, robot, and fuel models

## Tech Stack

- [Three.js](https://threejs.org/) – 3D rendering & FBX loading
- [Cannon-es](https://pmndrs.github.io/cannon-es/) – Physics engine
- [Vite](https://vitejs.dev/) – Dev server & bundler

## Build for Production

```bash
npm run build
npm run preview
```

Output goes to `dist/`.
