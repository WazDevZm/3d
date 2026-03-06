# Virtual Electronics Lab

> A browser-based 3D electronics workbench controlled entirely by hand gestures via your webcam — no hardware, no installs, no accounts.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
  - [Module Map](#module-map)
  - [Data Flow](#data-flow)
  - [Coordinate System](#coordinate-system)
  - [Circuit Simulation Engine](#circuit-simulation-engine)
- [Components](#components)
- [Gesture Reference](#gesture-reference)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Configuration](#configuration)
- [Tech Stack](#tech-stack)
- [Development](#development)
- [Known Limitations](#known-limitations)
- [Author](#author)

---

## Overview

Virtual Electronics Lab lets you pick up resistors, LEDs, and batteries with your bare hands, wire them together, and watch LEDs light up the moment a valid circuit loop closes — all inside a standard browser tab.

Hand tracking runs 100% client-side via **MediaPipe Hands** (a TFLite WASM model). No video data ever leaves your machine. The 3D workspace is rendered in WebGL by **Three.js**. Circuit topology is evaluated in real time by a custom **graph DFS engine**.

---

## Features

- **Real-time hand tracking** — MediaPipe detects 21 landmarks on each hand at up to 30 fps, with both hands tracked simultaneously
- **Live circuit simulation** — DFS graph engine checks for completed battery → resistor → LED loops on every topology change
- **3D component workspace** — Three.js renders pickup animations, tilt physics, drop shadows, and smooth Y-axis lerping
- **Pinch gesture control** — Hysteresis-based pinch detection prevents jitter during grab, drag, and drop
- **Wire drawing mode** — Pinch any terminal, drag to another terminal, release to connect; uses `QuadraticBezierCurve3`
- **Two-hand rotation** — Hold a component with one hand and use the second to rotate it around the Y axis
- **Delete mode** — Pinch a component or wire to remove it from the scene
- **Component palette** — Click any palette item to drop a new component into the workspace
- **PiP webcam feed** — Picture-in-picture overlay shows the mirrored hand skeleton
- **Toast notifications** — Non-intrusive feedback for every action
- **Zero dependencies** — No npm, no bundler, no build step required

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/WazDevZm/3d.git
cd 3d

# Start the dev server (ES modules require HTTP, not file://)
python3 server.py
```

The server opens `http://localhost:8000/landing.html` automatically.

To use a different port:

```bash
python3 server.py 3000
```

> **Note:** Chrome or Edge recommended. Allow webcam access when prompted. Works best in good ambient lighting.

---

## Project Structure

```text
3d/
├── index.html              # Main application shell (UI layout, importmap, CDN tags)
├── landing.html            # Marketing landing page (dark theme, gradient text)
├── server.py               # Minimal Python HTTP server with CORS + MIME headers
├── css/
│   └── styles.css          # Dark lab theme — all UI panels, overlays, toast styles
└── js/
    ├── config.js           # All tuneable constants (thresholds, colours, dimensions)
    ├── HandTracker.js      # MediaPipe wrapper; draws mirrored PiP skeleton
    ├── GestureRecognizer.js# Raw landmarks → {isPinching, pinchPoint, palmCenter, …}
    ├── components.js       # BaseComponent + Resistor, LED, Battery, Breadboard, Wire
    ├── SceneManager.js     # Three.js scene, camera, lighting, workbench, 3D cursor
    ├── CircuitSim.js       # Graph DFS circuit simulation engine
    ├── Workspace.js        # SELECT / WIRE / DELETE modes; grab, snap, rotation
    └── main.js             # Entry point — animation loop, UI event bindings
```

---

## Architecture

### Module Map

```text
index.html
  └─ main.js
        ├── HandTracker.js          (MediaPipe camera loop)
        │       └── GestureRecognizer.js  (landmark math)
        ├── SceneManager.js         (Three.js WebGL renderer)
        ├── Workspace.js            (interaction state machine)
        │       ├── components.js   (3D meshes + terminals)
        │       └── CircuitSim.js   (graph DFS engine)
        └── config.js               (shared constants)
```

### Data Flow

```text
Webcam frame
  → MediaPipe Hands (WASM, runs in main thread)
  → HandTracker.onResults callback
  → GestureRecognizer.recognize()
       returns: [{ hand, isPinching, pinchPoint, palmCenter, … }]
  → Workspace.tick()
       updates: component positions, wire drawing state, mode transitions
  → CircuitSim.simulate()  (on topology change only)
       fires: CustomEvent('circuit:update', { anyLit })
  → SceneManager.render()
       Three.js requestAnimationFrame loop
```

### Coordinate System

MediaPipe returns normalised `[0, 1]` coordinates. These are mapped to Three.js world space each frame:

| MediaPipe | Three.js world |
| --------- | -------------- |
| `x ∈ [0,1]` (left→right in raw frame) | `x ∈ [-9, 9]` **(mirrored)** so the user's right hand maps to scene-right |
| `y ∈ [0,1]` (top→bottom) | mapped to `z ∈ [-7, 7]` (depth axis) |
| Component height | driven by state: `REST=0`, `HOVER=0.45`, `GRABBED=2.8` (lerped per frame) |

Mirroring formula (from `js/config.js`):

```js
worldX = (1 - normX) * X_SCALE + X_OFFSET   // X_SCALE=18, X_OFFSET=-9
worldZ =  normY      * Z_SCALE + Z_OFFSET    // Z_SCALE=14, Z_OFFSET=-7
```

### Circuit Simulation Engine

`js/CircuitSim.js` models the circuit as an **undirected graph**:

- **Nodes** — component terminals (`Terminal` objects with `.id` and `.type`)
- **Edges** — `Wire` objects connecting two terminals

On every topology change it runs a DFS to find a valid path:

```text
battery.positive → [any resistors / breadboard] → led.anode
led.cathode      → [any path]                   → battery.negative
```

LEDs are **directional** — the DFS cannot pass through them arbitrarily. A separate sub-path check is performed for each half of the loop. This correctly handles series resistor-LED chains as used in real beginner circuits.

The engine dispatches `CustomEvent('circuit:update', { anyLit })` so `main.js` can update the UI without being tightly coupled to the sim.

---

## Components

| Component | Types available | Terminals |
| --------- | --------------- | --------- |
| **Battery** | 9 V, 5 V | `positive`, `negative` |
| **Resistor** | 220 Ω, 1 kΩ, 10 kΩ | `a`, `b` |
| **LED** | Red, Green, Blue, Yellow | `anode`, `cathode` |
| **Breadboard** | — | 6 junction rows |
| **Wire** | (drawn by user) | two endpoints |

All components extend `BaseComponent` which provides:

| Method | Description |
| ------ | ----------- |
| `setXZ(x, z)` | Move in the horizontal plane (clamped to workspace bounds) |
| `tick(dt)` | Lerps Y position, scale, and tilt each frame |
| `setHovered(bool)` | Raises component slightly, highlights terminals |
| `setGrabbed(bool)` | Lifts to `Y.GRABBED`, scales up, enables tilt physics |
| `setActive(bool)` | Triggers emissive glow (used when an LED lights up) |
| `light(bool)` | LED-specific — enables/disables point light and emissive material |

---

## Gesture Reference

| Gesture | Action |
| ------- | ------ |
| **Pinch** (thumb + index close together) | Grab a component / start drawing a wire |
| **Open hand** | Hover / highlight the nearest component |
| **Release pinch** | Drop component / finish wire connection |
| **Two hands — both pinching** | Rotate the held component around its Y axis |
| **Pinch a terminal in Wire mode** | Start drawing a connection from that terminal |
| **Release on another terminal** | Complete the wire and register the connection |
| **Pinch any object in Delete mode** | Remove that component or wire from the scene |

**Pinch detection** uses hysteresis to prevent jitter:

- Engages when thumb-tip / index-tip distance < `0.065` (normalised)
- Releases when distance > `0.085` (wider threshold prevents accidental release)

---

## Keyboard Shortcuts

| Key | Action |
| --- | ------ |
| `S` | Switch to Select mode |
| `W` | Switch to Wire mode |
| `D` | Switch to Delete mode |
| `Escape` | Return to Select mode |

---

## Configuration

All tuneable constants live in `js/config.js`. Key sections:

```js
// Gesture sensitivity
CONFIG.GESTURE.PINCH_THRESHOLD    // 0.065  — distance to trigger pinch
CONFIG.GESTURE.PINCH_HYSTERESIS   // 0.085  — wider release threshold
CONFIG.GESTURE.GRAB_RADIUS        // 2.5    — world-unit sphere to pick up a component
CONFIG.GESTURE.TERMINAL_RADIUS    // 1.4    — snap radius for wire terminal snapping
CONFIG.GESTURE.ROTATION_DEADZONE  // 0.04   — min angle delta for two-hand rotation

// Component height states
CONFIG.Y.REST                     // 0.0    — resting on the workbench
CONFIG.Y.HOVER                    // 0.45   — raised when hand hovers nearby
CONFIG.Y.GRABBED                  // 2.8    — held height (dramatic 3D lift)

// Pickup animation
CONFIG.PICKUP.SCALE_GRABBED       // 1.13   — component grows slightly when held
CONFIG.PICKUP.TILT_FACTOR         // 0.30   — max tilt (radians) driven by velocity
CONFIG.PICKUP.TILT_DAMPING        // 0.80   — tilt decay rate when stationary
CONFIG.PICKUP.SHADOW_MAX_OPACITY  // 0.30   — shadow opacity when resting
CONFIG.PICKUP.SHADOW_MIN_OPACITY  // 0.07   — shadow opacity at full grab height

// Circuit feedback
CONFIG.CIRCUIT.LED_ON_INTENSITY   // 0.95   — emissive intensity when LED is lit
CONFIG.CIRCUIT.LED_OFF_INTENSITY  // 0.08   — dim glow when circuit is open
CONFIG.CIRCUIT.LIGHT_INTENSITY    // 2.5    — Three.js PointLight intensity when LED on
```

---

## Tech Stack

| Technology | Version | Role |
| ---------- | ------- | ---- |
| [Three.js](https://threejs.org) | r160 | WebGL 3D rendering — geometry, lighting, materials, animation loop |
| [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands) | 0.4.1646424915 | 21-landmark real-time hand detection via TFLite WASM |
| ES Modules + importmap | Native browser | Zero-bundler module loading |
| Vanilla JS | — | Gesture math, coordinate mapping, lerp animation |
| Python 3 | stdlib only | Dev HTTP server with correct CORS + MIME headers |

Three.js is loaded via an **importmap** in `index.html`. MediaPipe is loaded as a global CDN script. COOP/COEP headers are **intentionally omitted** from the server — they block MediaPipe from fetching its own WASM model files from the CDN.

---

## Development

### Running the server

```bash
python3 server.py          # serves on http://localhost:8000
python3 server.py 3000     # serves on http://localhost:3000
```

The server suppresses 200/304 request logs and only prints errors. It sets `Access-Control-Allow-Origin: *` so all CDN assets load without CORS issues.

### Adding a new component type

1. Add a constant to `CT` in `js/config.js`
2. Create a class extending `BaseComponent` in `js/components.js`, implementing `_buildMesh()` and `_buildTerminals()`
3. Register it in the `addComponent()` switch statement inside `js/Workspace.js`
4. Add a palette button in `index.html`

### Adding a new gesture

1. Compute the gesture from raw landmarks in `GestureRecognizer.recognize()` (`js/GestureRecognizer.js`)
2. Return a new field in the gesture result object
3. Consume the field in `Workspace.tick()` (`js/Workspace.js`)

### File relationships at a glance

```text
config.js      ← imported by almost every module (constants only, no side effects)
HandTracker    ← wraps MediaPipe; fires onResults callback with raw landmark data
GestureRecognizer ← pure function; no state, no DOM; maps landmarks to gesture objects
SceneManager   ← owns the Three.js renderer, camera, workbench mesh, and 3D cursor
components.js  ← owns Three.js meshes; knows nothing about gestures or DOM
CircuitSim     ← owns the graph; knows nothing about Three.js or gestures
Workspace      ← the glue layer; reads gestures, mutates components and circuit
main.js        ← bootstraps everything, runs rAF loop, owns all DOM references
```

---

## Known Limitations

- **Topology-only simulation** — voltage and current values are not computed; the engine only checks whether a valid loop exists
- **No persistence** — the workspace resets on page reload; there is no save/load/export
- **Single webcam** — multi-camera switching is not implemented
- **Lighting sensitivity** — MediaPipe tracking degrades in very dark or strongly backlit environments
- **Desktop only** — designed for laptop webcams; no touch/mobile interaction layer

---

## Author

**Wazingwa Mugala**
Software Engineer — Polaris Cloud AI

---

*Built with Three.js r160, MediaPipe Hands, and zero build tools.*
