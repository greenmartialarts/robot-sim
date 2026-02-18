## Plan: Web-Based FRC Swerve Robot Simulation

This plan outlines the steps to build a web-based, driver-station POV simulation for an FRC swerve-drive robot using provided FBX models. The simulation will focus on realistic driving, fuel pickup, and shooting, optimized for mid-performance laptops. Controls will be keyboard-based, with shooter parameters set in code. The camera will be positioned at configurable driver station spots.

**Steps**
1. **Project Setup**
   - Initialize a web project using Three.js (3D rendering) and Cannon.js (physics).
   - Set up a basic HTML/JS or TypeScript environment (user can choose JS or TS).

2. **Model Import**
   - Load field-2026.fbx, Robot.fbx, and Fuel.fbx into the Three.js scene.
   - Place the field as the environment, robot at a starting position, and fuel elements on the field.

3. **Camera System**
   - Implement a camera system with three configurable driver station positions (POV or over-the-shoulder).
   - Allow easy adjustment of camera coordinates in code.

4. **Swerve Drive & Controls**
   - Implement field-centric swerve drive logic using keyboard input (WASD for translation, QE for rotation).
   - Ensure forward is always “up” relative to the field, regardless of robot orientation.

5. **Physics Integration**
   - Use Cannon.js to handle robot, field, and fuel collisions.
   - Ensure realistic movement, acceleration, and collision response.

6. **Fuel Pickup & Ball Count**
   - Detect collision between the robot’s intake (front) and fuel.
   - Remove fuel from the field and increment the robot’s ball count (max 1).

7. **Shooting Mechanism**
   - On shoot command (keyboard), launch a ball from the robot using tunable angle and distance (set in code).
   - Animate the ball’s trajectory using physics, decrement ball count.

8. **UI Overlay**
   - Display current ball count and successful shots on screen.

9. **Performance Optimization**
   - Optimize rendering and physics steps for smooth performance on mid-range laptops.

**Verification**
- Load the simulation in a browser on a mid-performance laptop.
- Confirm models load and render correctly.
- Test keyboard controls for swerve drive and field-centric movement.
- Verify camera switches to each driver station spot.
- Check fuel pickup and shooting logic, with ball count updating.
- Observe realistic physics for robot and fuel.
- Ensure UI overlay displays correct information.

**Decisions**
- Three.js chosen for 3D and FBX support; Cannon.js for physics.
- Keyboard controls for MVP; gamepad can be added later.
- Shooter parameters and camera positions are code-configurable.
- No multiplayer or backend required for MVP.

This plan is ready for implementation. Let me know if you want any changes or if you’d like to proceed!
