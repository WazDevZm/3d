// ── components.js ────────────────────────────────────────────────────────────
// 3D electronic component classes built with Three.js geometry.
// Each component extends BaseComponent which handles:
//   - Three.js Group (this.mesh) that can be added to the scene
//   - Terminal (connection-point) management
//   - Hover / grabbed / active visual state transitions

import * as THREE from 'three';
import { CONFIG, CT } from './config.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function phong(color, opts = {}) {
  return new THREE.MeshPhongMaterial({ color, ...opts });
}

function terminalMarker(color) {
  const geo = new THREE.SphereGeometry(0.14, 8, 8);
  const mat = new THREE.MeshPhongMaterial({
    color,
    emissive:          color,
    emissiveIntensity: 0.4,
    transparent:       true,
    opacity:           0.85,
  });
  return new THREE.Mesh(geo, mat);
}

let _uidCounter = 0;
function uid(prefix) { return `${prefix}_${++_uidCounter}`; }

// ── BaseComponent ─────────────────────────────────────────────────────────────

export class BaseComponent {
  /**
   * @param {string}        type     – from CT.*
   * @param {THREE.Scene}   scene
   */
  constructor(type, scene) {
    this.id       = uid(type);
    this.type     = type;
    this.scene    = scene;

    /** World position (y is always driven by state, x/z set externally) */
    this.px = 0;
    this.pz = 0;
    this._targetY = CONFIG.Y.REST;
    this._currentY = CONFIG.Y.REST;

    /** Rotation around world-Y axis, in radians */
    this.rotation = 0;

    /** Terminal array – each: { id, localOffset:{x,y,z}, worldPos:{x,y,z},
     *                           connected:Terminal|null, marker:Mesh, type? } */
    this.terminals = [];

    this.isHovered  = false;
    this.isGrabbed  = false;
    this.isActive   = false;   // e.g. LED is lit

    // Animation state
    this._currentScale = 1.0;
    this._tiltX = 0;   // radians, driven by Z velocity
    this._tiltZ = 0;   // radians, driven by X velocity
    this._lastPx = 0;
    this._lastPz = 0;

    // Shadow size – subclasses set these in _buildMesh() if desired
    this._shadowW = 2.2;
    this._shadowD = 0.9;

    // Build geometry
    this.mesh = new THREE.Group();
    this._buildMesh();
    this._buildTerminals();
    this.mesh.position.set(0, CONFIG.Y.REST, 0);
    scene.add(this.mesh);

    // Drop shadow (built after _buildMesh so shadow dimensions are final)
    this._buildShadow();
  }

  // Override in subclasses
  _buildMesh()      {}
  _buildTerminals() {}

  // ── Drop shadow ──────────────────────────────────────────────────────────

  _buildShadow() {
    // THREE.EllipseGeometry does not exist — build an ellipse via ShapeGeometry
    const rw  = this._shadowW * 0.5;
    const rd  = this._shadowD * 0.5;
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      pts.push(new THREE.Vector2(Math.cos(a) * rw, Math.sin(a) * rd));
    }
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));

    this._shadowMat = new THREE.MeshBasicMaterial({
      color:       0x000000,
      transparent: true,
      opacity:     CONFIG.PICKUP.SHADOW_MAX_OPACITY,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });
    this._shadowMesh = new THREE.Mesh(geo, this._shadowMat);
    this._shadowMesh.rotation.x = -Math.PI / 2;
    this.scene.add(this._shadowMesh);
    this._shadowMesh.position.set(this.px, 0.008, this.pz);
  }

  // ── Positioning ─────────────────────────────────────────────────────────

  setXZ(x, z) {
    this.px = Math.max(-10, Math.min(10, x));
    this.pz = Math.max(-7,  Math.min(7,  z));
    this.mesh.position.x = this.px;
    this.mesh.position.z = this.pz;
    this._refreshTerminals();
  }

  /** Snap position to workspace grid */
  snapToGrid() {
    const g = CONFIG.WORKSPACE.GRID_SIZE;
    this.setXZ(
      Math.round(this.px / g) * g,
      Math.round(this.pz / g) * g,
    );
  }

  setRotation(rad) {
    this.rotation = rad;
    this.mesh.rotation.y = rad;
    this._refreshTerminals();
  }

  /** Smooth Y animation – called each frame from Workspace.tick() */
  tickY(dt) {
    const { PICKUP, Y, SNAP_LERP } = CONFIG;

    // ── 1. Vertical position ───────────────────────────────────────────────
    this._targetY = this.isGrabbed ? Y.GRABBED : this.isHovered ? Y.HOVER : Y.REST;
    this._currentY += (this._targetY - this._currentY) * SNAP_LERP;
    this.mesh.position.y = this._currentY;

    // ── 2. Scale (swell up when grabbed) ──────────────────────────────────
    const scaleTarget = this.isGrabbed ? PICKUP.SCALE_GRABBED : 1.0;
    this._currentScale += (scaleTarget - this._currentScale) * PICKUP.SCALE_LERP;
    this.mesh.scale.setScalar(this._currentScale);

    // ── 3. Velocity-driven tilt ────────────────────────────────────────────
    const vx = this.px - this._lastPx;
    const vz = this.pz - this._lastPz;
    this._lastPx = this.px;
    this._lastPz = this.pz;

    if (this.isGrabbed) {
      // Target tilt based on current frame velocity (capped)
      const cap = 0.35;
      const tx = Math.max(-cap, Math.min(cap,  vz * PICKUP.TILT_FACTOR * 60));
      const tz = Math.max(-cap, Math.min(cap, -vx * PICKUP.TILT_FACTOR * 60));
      this._tiltX += (tx - this._tiltX) * 0.25;
      this._tiltZ += (tz - this._tiltZ) * 0.25;
    } else {
      // Decay tilt back to flat
      this._tiltX *= PICKUP.TILT_DAMPING;
      this._tiltZ *= PICKUP.TILT_DAMPING;
    }
    this.mesh.rotation.x = this._tiltX;
    this.mesh.rotation.z = this._tiltZ;

    // ── 4. Drop shadow ─────────────────────────────────────────────────────
    if (this._shadowMesh) {
      // Shadow sits on the surface, tracking XZ
      this._shadowMesh.position.set(this.px, 0.008, this.pz);

      // Shadow grows and fades as component rises
      const h     = Math.max(0, this._currentY);
      const spread = 1 + h * PICKUP.SHADOW_SPREAD;
      this._shadowMesh.scale.setScalar(spread);

      const opacity = PICKUP.SHADOW_MAX_OPACITY -
        (PICKUP.SHADOW_MAX_OPACITY - PICKUP.SHADOW_MIN_OPACITY) *
        (h / Y.GRABBED);
      this._shadowMat.opacity = Math.max(PICKUP.SHADOW_MIN_OPACITY, opacity);
    }

    // ── 5. Terminal markers stay on the surface ────────────────────────────
    for (const t of this.terminals) {
      if (t.marker) t.marker.position.set(t.worldPos.x, 0.22, t.worldPos.z);
    }
  }

  // ── State ────────────────────────────────────────────────────────────────

  setHovered(v)  { this.isHovered  = v; this._onStateChange(); }
  setGrabbed(v)  { this.isGrabbed  = v; this._onStateChange(); }
  setActive(v)   { this.isActive   = v; this._onStateChange(); }

  // Override for custom visual feedback
  _onStateChange() {}

  // ── Terminals ────────────────────────────────────────────────────────────

  _refreshTerminals() {
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);

    for (const t of this.terminals) {
      const lx = t.localOffset.x;
      const lz = t.localOffset.z;
      t.worldPos.x = this.px + cos * lx - sin * lz;
      t.worldPos.z = this.pz + sin * lx + cos * lz;
      t.worldPos.y = t.localOffset.y;
      if (t.marker) {
        t.marker.position.set(t.worldPos.x, 0.22, t.worldPos.z);
      }
    }
  }

  /** Returns first terminal within `radius` of worldPos, or null */
  terminalNear(worldPos, radius = CONFIG.GESTURE.TERMINAL_RADIUS) {
    for (const t of this.terminals) {
      const dx = t.worldPos.x - worldPos.x;
      const dz = t.worldPos.z - worldPos.z;
      if (Math.sqrt(dx * dx + dz * dz) < radius) return t;
    }
    return null;
  }

  /** Highlight/dim terminal markers based on proximity */
  updateTerminalHighlight(handPos) {
    for (const t of this.terminals) {
      if (!t.marker) continue;
      const dx   = t.worldPos.x - handPos.x;
      const dz   = t.worldPos.z - handPos.z;
      const near = Math.sqrt(dx * dx + dz * dz) < CONFIG.GESTURE.TERMINAL_RADIUS;
      t.marker.material.emissiveIntensity = near ? 1.0 : 0.4;
      const s = near ? 1.6 : 1.0;
      t.marker.scale.setScalar(s);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  dispose() {
    // Drop shadow
    if (this._shadowMesh) {
      this.scene.remove(this._shadowMesh);
      this._shadowMesh.geometry.dispose();
      this._shadowMat.dispose();
      this._shadowMesh = null;
    }
    // Main mesh
    this.scene.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material])
          .forEach((m) => m.dispose());
      }
    });
    // Terminal markers
    for (const t of this.terminals) {
      if (t.marker) {
        this.scene.remove(t.marker);
        t.marker.geometry.dispose();
        t.marker.material.dispose();
      }
    }
  }
}

// ── Resistor ─────────────────────────────────────────────────────────────────

const RESISTOR_BANDS = {
  [CT.RESISTOR_220]: [0xff2200, 0xff2200, 0x8B4513, 0xFFD700], // 220Ω  R-R-Brn-Gold
  [CT.RESISTOR_1K]:  [0x8B4513, 0x000000, 0xff2200, 0xFFD700], // 1kΩ   Brn-Blk-R-Gold
  [CT.RESISTOR_10K]: [0x8B4513, 0x000000, 0xff8c00, 0xFFD700], // 10kΩ  Brn-Blk-Or-Gold
};

export class Resistor extends BaseComponent {
  constructor(type, scene) {
    super(type, scene);
  }

  _buildMesh() {
    this._shadowW = 3.6;   // elongated pill shadow
    this._shadowD = 0.7;

    const bands = RESISTOR_BANDS[this.type] ?? RESISTOR_BANDS[CT.RESISTOR_220];

    // Body
    const bodyGeo = new THREE.CylinderGeometry(0.22, 0.22, 2.2, 14);
    this._bodyMat = phong(0xD4C09A, { shininess: 30 });
    const body = new THREE.Mesh(bodyGeo, this._bodyMat);
    body.rotation.z = Math.PI / 2;
    body.castShadow = true;
    this.mesh.add(body);

    // Colour bands
    const bandXs = [-0.65, -0.2, 0.25, 0.82];
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.CylinderGeometry(0.235, 0.235, 0.13, 14);
      const mat = phong(bands[i]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.x = bandXs[i];
      this.mesh.add(mesh);
    }

    // Leads
    const leadMat = phong(0xBBBBBB);
    [-1.35, 1.35].forEach((x) => {
      const geo  = new THREE.CylinderGeometry(0.055, 0.055, 0.55, 8);
      const mesh = new THREE.Mesh(geo, leadMat);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.x = x;
      this.mesh.add(mesh);
    });
  }

  _buildTerminals() {
    const t0 = terminalMarker(0x888888);
    const t1 = terminalMarker(0x888888);
    this.scene.add(t0);
    this.scene.add(t1);

    this.terminals = [
      { id: `${this.id}_a`, localOffset: { x: -1.65, y: 0.1, z: 0 },
        worldPos: { x: 0, y: 0, z: 0 }, connected: null, marker: t0 },
      { id: `${this.id}_b`, localOffset: { x:  1.65, y: 0.1, z: 0 },
        worldPos: { x: 0, y: 0, z: 0 }, connected: null, marker: t1 },
    ];
    this._refreshTerminals();
  }

  _onStateChange() {
    if (this.isGrabbed) {
      this._bodyMat.emissive.setHex(0x3355ff);
      this._bodyMat.emissiveIntensity = 0.4;
    } else if (this.isHovered) {
      this._bodyMat.emissive.setHex(0x1133aa);
      this._bodyMat.emissiveIntensity = 0.25;
    } else {
      this._bodyMat.emissiveIntensity = 0;
    }
  }
}

// ── LED ───────────────────────────────────────────────────────────────────────

const LED_COLORS = {
  [CT.LED_RED]:    0xff2200,
  [CT.LED_GREEN]:  0x00ff44,
  [CT.LED_BLUE]:   0x2244ff,
  [CT.LED_YELLOW]: 0xffdd00,
};

export class LED extends BaseComponent {
  constructor(type, scene) {
    super(type, scene);
    this._isLit = false;
  }

  _buildMesh() {
    this._shadowW = 0.9;   // small circular shadow
    this._shadowD = 0.9;

    this._ledColor = LED_COLORS[this.type] ?? 0xff2200;

    // Transparent dome
    const domeGeo = new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
    this._domeMat = new THREE.MeshPhongMaterial({
      color:             this._ledColor,
      emissive:          this._ledColor,
      emissiveIntensity: CONFIG.CIRCUIT.LED_OFF_INTENSITY,
      transparent:       true,
      opacity:           0.82,
      shininess:         120,
    });
    const dome = new THREE.Mesh(domeGeo, this._domeMat);
    dome.position.y = 0.55;
    dome.castShadow = true;
    this.mesh.add(dome);

    // Flat body base
    const bodyGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.55, 16);
    this._bodyMat = new THREE.MeshPhongMaterial({
      color:       this._ledColor,
      transparent: true,
      opacity:     0.65,
    });
    const body = new THREE.Mesh(bodyGeo, this._bodyMat);
    body.position.y = 0.27;
    this.mesh.add(body);

    // Leads: anode (longer, right) and cathode (shorter, left)
    const leadMat = phong(0xCCCCCC);
    const anodeGeo   = new THREE.CylinderGeometry(0.045, 0.045, 0.65, 8);
    const cathodeGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.45, 8);

    const anode = new THREE.Mesh(anodeGeo, leadMat);
    anode.position.set(0.12, -0.33, 0);
    this.mesh.add(anode);

    const cathode = new THREE.Mesh(cathodeGeo, leadMat);
    cathode.position.set(-0.12, -0.23, 0);
    this.mesh.add(cathode);

    // Internal point-light (off by default)
    this._light = new THREE.PointLight(
      this._ledColor,
      0,
      CONFIG.CIRCUIT.LIGHT_DISTANCE,
    );
    this._light.position.y = 0.7;
    this.mesh.add(this._light);
  }

  _buildTerminals() {
    const aTerm = terminalMarker(0xff4444);   // anode  = +
    const cTerm = terminalMarker(0x4466ff);   // cathode = -
    this.scene.add(aTerm);
    this.scene.add(cTerm);

    this.terminals = [
      { id: `${this.id}_anode`,   type: 'anode',
        localOffset: { x: 0.12, y: 0, z: 0 },
        worldPos: { x: 0, y: 0, z: 0 }, connected: null, marker: aTerm },
      { id: `${this.id}_cathode`, type: 'cathode',
        localOffset: { x: -0.12, y: 0, z: 0 },
        worldPos: { x: 0, y: 0, z: 0 }, connected: null, marker: cTerm },
    ];
    this._refreshTerminals();
  }

  light(on) {
    this._isLit = on;
    const i = on ? CONFIG.CIRCUIT.LED_ON_INTENSITY : CONFIG.CIRCUIT.LED_OFF_INTENSITY;
    this._domeMat.emissiveIntensity = i;
    this._light.intensity = on ? CONFIG.CIRCUIT.LIGHT_INTENSITY : 0;
  }

  _onStateChange() {
    if (this.isGrabbed) {
      this._bodyMat.emissive = new THREE.Color(0x3355ff);
      this._bodyMat.emissiveIntensity = 0.35;
    } else {
      this._bodyMat.emissive = new THREE.Color(0);
      this._bodyMat.emissiveIntensity = 0;
    }
  }
}

// ── Battery ───────────────────────────────────────────────────────────────────

export class Battery extends BaseComponent {
  constructor(type, scene) {
    super(type, scene);
    this._voltage = type === CT.BATTERY_9V ? 9 : 5;
  }

  _buildMesh() {
    this._shadowW = 4.2;   // elongated battery shadow
    this._shadowD = 1.3;

    // Body cylinder (horizontal)
    const bodyGeo = new THREE.CylinderGeometry(0.58, 0.58, 3.2, 18);
    this._bodyMat = phong(0x1a1a1a, { shininess: 60 });
    const body = new THREE.Mesh(bodyGeo, this._bodyMat);
    body.rotation.z = Math.PI / 2;
    body.castShadow = true;
    this.mesh.add(body);

    // Positive nub
    const posGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.22, 14);
    const posMat = phong(0xff3333);
    const posNub = new THREE.Mesh(posGeo, posMat);
    posNub.rotation.z = Math.PI / 2;
    posNub.position.x = 1.72;
    this.mesh.add(posNub);

    // Negative flat cap
    const negGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.12, 18);
    const negMat = phong(0x777777);
    const negCap = new THREE.Mesh(negGeo, negMat);
    negCap.rotation.z = Math.PI / 2;
    negCap.position.x = -1.66;
    this.mesh.add(negCap);

    // Label strip (white band)
    const labelGeo = new THREE.CylinderGeometry(0.595, 0.595, 1.8, 18);
    const labelMat = phong(0xffffff, { shininess: 10 });
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.rotation.z = Math.PI / 2;
    label.position.x = 0.2;
    this.mesh.add(label);

    // Voltage text representation (simple colored stripe)
    const voltGeo = new THREE.BoxGeometry(1.4, 0.02, 0.3);
    const voltMat = phong(0x222222);
    const voltLabel = new THREE.Mesh(voltGeo, voltMat);
    voltLabel.position.set(0.2, 0.6, 0);
    this.mesh.add(voltLabel);

    this.mesh.position.y = 0.62;
  }

  _buildTerminals() {
    const posMark = terminalMarker(0xff3333);
    const negMark = terminalMarker(0x4466ff);
    this.scene.add(posMark);
    this.scene.add(negMark);

    this.terminals = [
      { id: `${this.id}_pos`, type: 'positive',
        localOffset: { x:  1.85, y: 0.62, z: 0 },
        worldPos: { x: 0, y: 0, z: 0 }, connected: null, marker: posMark },
      { id: `${this.id}_neg`, type: 'negative',
        localOffset: { x: -1.85, y: 0.62, z: 0 },
        worldPos: { x: 0, y: 0, z: 0 }, connected: null, marker: negMark },
    ];
    this._refreshTerminals();
  }

  _onStateChange() {
    if (this.isGrabbed) {
      this._bodyMat.emissive.setHex(0x3355ff);
      this._bodyMat.emissiveIntensity = 0.4;
    } else if (this.isHovered) {
      this._bodyMat.emissive.setHex(0x1133aa);
      this._bodyMat.emissiveIntensity = 0.2;
    } else {
      this._bodyMat.emissiveIntensity = 0;
    }
  }
}

// ── Breadboard ────────────────────────────────────────────────────────────────

export class Breadboard extends BaseComponent {
  constructor(type, scene) {
    super(type, scene);
  }

  _buildMesh() {
    this._shadowW = 12.0;  // large breadboard shadow
    this._shadowD = 7.5;

    // Base board
    const baseGeo = new THREE.BoxGeometry(11, 0.22, 7);
    this._baseMat = phong(0xd9c87a, { shininess: 15 });
    const base = new THREE.Mesh(baseGeo, this._baseMat);
    base.receiveShadow = true;
    this.mesh.add(base);

    // Centre divider groove
    const divGeo = new THREE.BoxGeometry(11, 0.05, 0.3);
    const divMat = phong(0x999966);
    const div = new THREE.Mesh(divGeo, divMat);
    div.position.y = 0.14;
    this.mesh.add(div);

    // Power rail strips (red / blue)
    const railGeo = new THREE.BoxGeometry(10.6, 0.06, 0.28);
    const redMat  = phong(0xff4444);
    const blueMat = phong(0x4444ff);

    const railPositions = [
      { z: -3.18, mat: redMat  },
      { z: -2.82, mat: blueMat },
      { z:  2.82, mat: redMat  },
      { z:  3.18, mat: blueMat },
    ];
    for (const { z, mat } of railPositions) {
      const r = new THREE.Mesh(railGeo, mat);
      r.position.set(0, 0.16, z);
      this.mesh.add(r);
    }

    // Hole grid (small cylinders, instanced for performance)
    this._addHoles();

    this.mesh.position.y = 0.11;
  }

  _addHoles() {
    // Represent holes as a grid of small dark indentations
    const holeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 6);
    const holeMat = phong(0x333322);

    // 30 columns × 10 rows (simplified)
    const cols = 30, rows = 10;
    const startX = -4.85, startZ = -2.25;
    const stepX = 0.36, stepZ = 0.5;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const h = new THREE.Mesh(holeGeo, holeMat);
        h.position.set(startX + c * stepX, 0.21, startZ + r * stepZ);
        this.mesh.add(h);
      }
    }
  }

  _buildTerminals() {
    // Breadboard has many connection points; expose the 4 power-rail corners
    // as terminals for circuit connectivity
    const colors = [0xff3333, 0x4466ff, 0xff3333, 0x4466ff];
    const offsets = [
      { x: -5, y: 0.3, z: -3.0 },
      { x: -5, y: 0.3, z: -2.65 },
      { x: -5, y: 0.3, z:  2.65 },
      { x: -5, y: 0.3, z:  3.0  },
    ];
    const types = ['power_pos', 'power_neg', 'power_pos', 'power_neg'];

    for (let i = 0; i < 4; i++) {
      const marker = terminalMarker(colors[i]);
      this.scene.add(marker);
      this.terminals.push({
        id:          `${this.id}_rail${i}`,
        type:        types[i],
        localOffset: offsets[i],
        worldPos:    { x: 0, y: 0, z: 0 },
        connected:   null,
        marker,
      });
    }
    this._refreshTerminals();
  }

  _onStateChange() {
    if (this.isGrabbed || this.isHovered) {
      this._baseMat.emissive.setHex(0x443300);
      this._baseMat.emissiveIntensity = this.isGrabbed ? 0.4 : 0.2;
    } else {
      this._baseMat.emissiveIntensity = 0;
    }
  }
}

// ── Wire ──────────────────────────────────────────────────────────────────────
// Wires are created/destroyed by the Workspace; they are not placed from the
// palette.  A Wire connects two terminals with a Bezier tube.

export class Wire {
  constructor(scene, startTerminal) {
    this.id            = uid(CT.WIRE);
    this.type          = CT.WIRE;
    this.scene         = scene;
    this.startTerminal = startTerminal;
    this.endTerminal   = null;
    this.color         = CONFIG.WIRE_COLORS.default;
    this.isComplete    = false;

    this._line = null;
    this._buildLine(startTerminal.worldPos, startTerminal.worldPos);
  }

  /** Update the wire end to follow the hand while drawing */
  updateTip(worldPos) {
    if (this.isComplete) return;
    this._buildLine(this.startTerminal.worldPos, worldPos);
  }

  /** Finalise connection to endTerminal */
  connect(endTerminal) {
    this.endTerminal = endTerminal;
    this.isComplete  = true;

    // Colour based on terminal type
    const t = this.startTerminal.type ?? endTerminal.type;
    if (t === 'positive' || t === 'anode' || t === 'power_pos') {
      this.color = CONFIG.WIRE_COLORS.positive;
    } else if (t === 'negative' || t === 'cathode' || t === 'power_neg') {
      this.color = CONFIG.WIRE_COLORS.negative;
    }
    this._buildLine(this.startTerminal.worldPos, endTerminal.worldPos);
  }

  /** Re-draw wire after a component is moved */
  refresh() {
    if (!this.isComplete || !this.endTerminal) return;
    this._buildLine(this.startTerminal.worldPos, this.endTerminal.worldPos);
  }

  _buildLine(start, end) {
    if (this._line) {
      this.scene.remove(this._line);
      this._line.geometry.dispose();
      this._line.material.dispose();
    }

    const s = new THREE.Vector3(start.x, 0.35, start.z);
    const e = new THREE.Vector3(end.x,   0.35, end.z);

    // Arch height proportional to distance
    const dist = s.distanceTo(e);
    const mid  = new THREE.Vector3(
      (s.x + e.x) / 2,
      0.35 + Math.max(0.5, dist * 0.25),
      (s.z + e.z) / 2,
    );

    const curve  = new THREE.QuadraticBezierCurve3(s, mid, e);
    const points = curve.getPoints(24);
    const geo    = new THREE.BufferGeometry().setFromPoints(points);
    const mat    = new THREE.LineBasicMaterial({ color: this.color, linewidth: 2 });

    this._line = new THREE.Line(geo, mat);
    this.scene.add(this._line);
  }

  dispose() {
    if (this._line) {
      this.scene.remove(this._line);
      this._line.geometry.dispose();
      this._line.material.dispose();
      this._line = null;
    }
  }
}

// ── Factory function ──────────────────────────────────────────────────────────

export function createComponent(type, scene) {
  switch (type) {
    case CT.BATTERY_9V:
    case CT.BATTERY_5V:
      return new Battery(type, scene);

    case CT.RESISTOR_220:
    case CT.RESISTOR_1K:
    case CT.RESISTOR_10K:
      return new Resistor(type, scene);

    case CT.LED_RED:
    case CT.LED_GREEN:
    case CT.LED_BLUE:
    case CT.LED_YELLOW:
      return new LED(type, scene);

    case CT.BREADBOARD:
      return new Breadboard(type, scene);

    default:
      console.warn('Unknown component type:', type);
      return new Resistor(CT.RESISTOR_220, scene);
  }
}
