// ── Workspace.js ─────────────────────────────────────────────────────────────
// Manages all electronic components on the workbench, processes gesture input,
// and orchestrates interaction states:
//
//   SELECT mode  – pinch to grab, drag to move, release to place, 2-hand rotate
//   WIRE mode    – pinch on terminal to start wire, drag, release on terminal
//   DELETE mode  – pinch on component to delete it
//
// Delegates circuit-logic to CircuitSim.

import { createComponent, Wire } from './components.js';
import { CONFIG, CT } from './config.js';

// ── Interaction state machines ────────────────────────────────────────────────

const Mode = { SELECT: 'select', WIRE: 'wire', DELETE: 'delete' };

export class Workspace {
  /**
   * @param {THREE.Scene}   scene
   * @param {SceneManager}  sceneMgr
   * @param {CircuitSim}    circuit
   */
  constructor(scene, sceneMgr, circuit) {
    this._scene    = scene;
    this._mgr      = sceneMgr;
    this._circuit  = circuit;
    this._mode     = Mode.SELECT;

    /** All placed components */
    this._components = [];
    /** All wire instances */
    this._wires = [];

    // ── Grab state ──────────────────────────────────────────────────────
    this._grab = {
      active:      false,
      component:   null,
      offsetX:     0,
      offsetZ:     0,
      wasPinching: false,
    };

    // ── Wire-draw state ─────────────────────────────────────────────────
    this._wireDraw = {
      active:       false,
      wire:         null,
      startTerminal: null,
      wasPinching:  false,
    };

    // ── Two-hand rotation tracking ───────────────────────────────────────
    this._prevHandAngle = null;

    // Seed the workspace with a demo circuit starter
    this._addDemoComponents();
  }

  // ── Mode control ─────────────────────────────────────────────────────────

  setMode(mode) {
    this._mode = mode;
    if (mode !== Mode.WIRE) this._cancelWire();
    if (mode !== Mode.SELECT) this._releaseGrab();
  }

  // ── Component management ─────────────────────────────────────────────────

  addComponent(type) {
    const comp = createComponent(type, this._scene);
    // Place near center with slight random offset
    const x = (Math.random() - 0.5) * 4;
    const z = (Math.random() - 0.5) * 3;
    comp.setXZ(x, z);
    this._components.push(comp);
    this._circuit.add(comp);
    return comp;
  }

  removeComponent(comp) {
    const idx = this._components.indexOf(comp);
    if (idx === -1) return;

    // Remove any wires connected to this component
    for (const t of comp.terminals) {
      const wire = this._circuit.disconnect(t);
      if (wire) {
        wire.dispose();
        const wi = this._wires.indexOf(wire);
        if (wi !== -1) this._wires.splice(wi, 1);
      }
    }

    this._circuit.remove(comp);
    this._components.splice(idx, 1);
    comp.dispose();
  }

  clearAll() {
    this._cancelWire();
    this._releaseGrab();
    this._circuit.clear();

    for (const w of this._wires) w.dispose();
    this._wires = [];

    for (const c of [...this._components]) {
      this._components.splice(this._components.indexOf(c), 1);
      c.dispose();
    }
    this._components = [];
  }

  // ── Per-frame update (called from main.js animation loop) ─────────────────

  /**
   * @param {Array<GestureObject>} gestures – output from GestureRecognizer
   * @param {number}               dt       – delta time in seconds
   */
  tick(gestures, dt) {
    const primaryGesture   = gestures[0] ?? null;
    const secondaryGesture = gestures[1] ?? null;

    // Resolve hand world position for cursor
    const handPos = primaryGesture
      ? (primaryGesture.isPinching ? primaryGesture.pinchPoint : primaryGesture.palmCenter)
      : null;

    // Update 3D cursor
    this._mgr.updateCursor(handPos, primaryGesture?.isPinching ?? false);

    // Per-component tick (Y animation, terminal highlight)
    for (const comp of this._components) {
      comp.tickY(dt);
      if (handPos) comp.updateTerminalHighlight(handPos);
    }

    if (!primaryGesture) {
      this._releaseGrab();
      this._grab.wasPinching   = false;
      this._wireDraw.wasPinching = false;
      return;
    }

    // Dispatch to active mode handler
    switch (this._mode) {
      case Mode.SELECT: this._handleSelect(primaryGesture, secondaryGesture, handPos, dt); break;
      case Mode.WIRE:   this._handleWire(primaryGesture, handPos); break;
      case Mode.DELETE: this._handleDelete(primaryGesture, handPos); break;
    }
  }

  // ── SELECT mode ───────────────────────────────────────────────────────────

  _handleSelect(primary, secondary, handPos, dt) {
    const justPinched  = primary.isPinching && !this._grab.wasPinching;
    const justReleased = !primary.isPinching && this._grab.wasPinching;

    if (justPinched && !this._grab.active) {
      const comp = this._nearestComponent(handPos, CONFIG.GESTURE.GRAB_RADIUS);
      if (comp) this._beginGrab(comp, handPos);
    }

    if (primary.isPinching && this._grab.active) {
      this._dragGrab(handPos);

      // Two-hand rotation
      if (secondary?.isPinching) {
        this._handleRotation(primary.palmCenter, secondary.palmCenter);
      } else {
        this._prevHandAngle = null;
      }
    }

    if (justReleased && this._grab.active) {
      this._releaseGrab();
    }

    if (!this._grab.active) {
      this._updateHover(handPos);
    }

    this._grab.wasPinching = primary.isPinching;
  }

  _beginGrab(comp, handPos) {
    this._grab.active    = true;
    this._grab.component = comp;
    this._grab.offsetX   = comp.px - handPos.x;
    this._grab.offsetZ   = comp.pz - handPos.z;
    comp.setGrabbed(true);
    comp.setHovered(false);

    // Temporarily remove from circuit so wires detach visually
    // (they'll reconnect on release)
    // We keep the component in _circuit so terminals remain valid for wire routing.
  }

  _dragGrab(handPos) {
    const comp = this._grab.component;
    if (!comp) return;
    const nx = handPos.x + this._grab.offsetX;
    const nz = handPos.z + this._grab.offsetZ;
    comp.setXZ(nx, nz);

    // Refresh any wires that are already connected to this component
    for (const wire of this._wires) {
      if (wire.isComplete) wire.refresh();
    }
  }

  _releaseGrab() {
    const comp = this._grab.component;
    if (!comp) return;
    comp.snapToGrid();
    comp.setGrabbed(false);

    // Refresh wires after snap
    for (const wire of this._wires) {
      if (wire.isComplete) wire.refresh();
    }

    this._grab.active    = false;
    this._grab.component = null;
    this._prevHandAngle  = null;

    // Re-run simulation (position change may affect connections)
    this._circuit.simulate();
  }

  _handleRotation(pos1, pos2) {
    const angle = Math.atan2(pos2.z - pos1.z, pos2.x - pos1.x);
    if (this._prevHandAngle !== null) {
      let delta = angle - this._prevHandAngle;
      // Clamp to avoid large jumps
      if (Math.abs(delta) < CONFIG.GESTURE.ROTATION_DEADZONE) delta = 0;
      if (Math.abs(delta) < 0.5 && this._grab.component) {
        this._grab.component.setRotation(
          this._grab.component.rotation + delta,
        );
      }
    }
    this._prevHandAngle = angle;
  }

  _updateHover(handPos) {
    for (const comp of this._components) {
      const dx   = comp.px - handPos.x;
      const dz   = comp.pz - handPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      comp.setHovered(dist < CONFIG.GESTURE.HOVER_RADIUS);
    }
  }

  _nearestComponent(handPos, radius) {
    let best = null, bestDist = radius;
    for (const comp of this._components) {
      const dx   = comp.px - handPos.x;
      const dz   = comp.pz - handPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) { bestDist = dist; best = comp; }
    }
    return best;
  }

  // ── WIRE mode ─────────────────────────────────────────────────────────────

  _handleWire(primary, handPos) {
    const justPinched  = primary.isPinching && !this._wireDraw.wasPinching;
    const justReleased = !primary.isPinching && this._wireDraw.wasPinching;

    if (justPinched && !this._wireDraw.active) {
      // Find a terminal near the hand
      const term = this._nearestTerminal(handPos);
      if (term) this._beginWire(term);
    }

    if (primary.isPinching && this._wireDraw.active) {
      this._wireDraw.wire.updateTip(handPos);
    }

    if (justReleased && this._wireDraw.active) {
      const endTerm = this._nearestTerminal(handPos);
      if (endTerm && endTerm !== this._wireDraw.startTerminal) {
        this._finishWire(endTerm);
      } else {
        this._cancelWire();
      }
    }

    this._wireDraw.wasPinching = primary.isPinching;
  }

  _beginWire(startTerm) {
    const wire = new Wire(this._scene, startTerm);
    this._wireDraw.active        = true;
    this._wireDraw.wire          = wire;
    this._wireDraw.startTerminal = startTerm;
  }

  _finishWire(endTerm) {
    const { wire, startTerminal } = this._wireDraw;
    wire.connect(endTerm);
    const added = this._circuit.connect(startTerminal, endTerm, wire);
    if (added) {
      this._wires.push(wire);
    } else {
      // Duplicate connection – discard without keeping in list
      wire.dispose();
    }
    this._wireDraw.active = false;
    this._wireDraw.wire   = null;
  }

  _cancelWire() {
    if (this._wireDraw.wire) {
      this._wireDraw.wire.dispose();
    }
    this._wireDraw.active        = false;
    this._wireDraw.wire          = null;
    this._wireDraw.startTerminal = null;
  }

  _nearestTerminal(handPos) {
    let best = null, bestDist = CONFIG.GESTURE.TERMINAL_RADIUS;
    for (const comp of this._components) {
      for (const t of comp.terminals) {
        const dx   = t.worldPos.x - handPos.x;
        const dz   = t.worldPos.z - handPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < bestDist) { bestDist = dist; best = t; }
      }
    }
    return best;
  }

  // ── DELETE mode ───────────────────────────────────────────────────────────

  _handleDelete(primary, handPos) {
    const justPinched = primary.isPinching && !this._grab.wasPinching;
    if (justPinched) {
      const comp = this._nearestComponent(handPos, CONFIG.GESTURE.GRAB_RADIUS);
      if (comp) {
        this.removeComponent(comp);
        window.dispatchEvent(new CustomEvent('workspace:toast', {
          detail: { msg: 'Component deleted', type: 'warn' },
        }));
      }
    }
    this._grab.wasPinching = primary.isPinching;
  }

  // ── Demo seed ─────────────────────────────────────────────────────────────

  _addDemoComponents() {
    // A 9V battery, a 220Ω resistor, and a red LED laid out ready to connect
    const battery = createComponent(CT.BATTERY_9V, this._scene);
    battery.setXZ(-5.5, 0);
    this._components.push(battery);
    this._circuit.add(battery);

    const resistor = createComponent(CT.RESISTOR_220, this._scene);
    resistor.setXZ(0, -1.5);
    this._components.push(resistor);
    this._circuit.add(resistor);

    const led = createComponent(CT.LED_RED, this._scene);
    led.setXZ(5.5, 0);
    this._components.push(led);
    this._circuit.add(led);

    // Also add a green LED for variety
    const led2 = createComponent(CT.LED_GREEN, this._scene);
    led2.setXZ(5.5, 3);
    this._components.push(led2);
    this._circuit.add(led2);
  }
}
