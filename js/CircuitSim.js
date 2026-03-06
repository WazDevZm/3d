// ── CircuitSim.js ────────────────────────────────────────────────────────────
// Graph-based circuit simulator.
//
// Model
// ─────
// The circuit is an undirected graph where:
//   • Nodes = component terminals (Terminal objects with .id, .type)
//   • Edges = Wire objects connecting two terminals
//
// On every topology change (connect / disconnect / add / remove component)
// we run a lightweight DFS to check whether each LED has a complete loop:
//
//   battery.positive → [any path through resistors / breadboard] →
//   led.anode → led.cathode → [any path] → battery.negative
//
// This correctly handles series resistor-LED chains as used in real beginner
// circuits. It does NOT compute voltages or currents (out of scope for MVP).

export class CircuitSim {
  constructor() {
    /** Map<componentId, BaseComponent> */
    this._components = new Map();

    /** Array<{ termA: Terminal, termB: Terminal, wire: Wire }> */
    this._edges = [];

    /** Adjacency: Map<terminalId, Set<terminalId>> */
    this._adj = new Map();
  }

  // ── Component registry ───────────────────────────────────────────────────

  add(component) {
    this._components.set(component.id, component);
    for (const t of component.terminals) {
      if (!this._adj.has(t.id)) this._adj.set(t.id, new Set());
    }
  }

  remove(component) {
    this._components.delete(component.id);

    // Remove all edges that touch this component's terminals
    const termIds = new Set(component.terminals.map((t) => t.id));
    this._edges = this._edges.filter((e) => {
      if (termIds.has(e.termA.id) || termIds.has(e.termB.id)) {
        // Disconnect the other terminal
        e.termA.connected = null;
        e.termB.connected = null;
        this._adj.get(e.termA.id)?.delete(e.termB.id);
        this._adj.get(e.termB.id)?.delete(e.termA.id);
        return false;
      }
      return true;
    });

    for (const t of component.terminals) {
      this._adj.delete(t.id);
    }

    this.simulate();
  }

  // ── Wire connections ─────────────────────────────────────────────────────

  /**
   * @returns {boolean} true if connection was added (false = already existed)
   */
  connect(termA, termB, wire) {
    const alreadyExists = this._edges.some(
      (e) =>
        (e.termA === termA && e.termB === termB) ||
        (e.termA === termB && e.termB === termA),
    );
    if (alreadyExists) return false;

    termA.connected = termB;
    termB.connected = termA;
    this._edges.push({ termA, termB, wire });

    // Update adjacency
    if (!this._adj.has(termA.id)) this._adj.set(termA.id, new Set());
    if (!this._adj.has(termB.id)) this._adj.set(termB.id, new Set());
    this._adj.get(termA.id).add(termB.id);
    this._adj.get(termB.id).add(termA.id);

    this.simulate();
    return true;
  }

  /**
   * Remove the wire that contains terminal `term` and update graph.
   * @returns {Wire|null}
   */
  disconnect(term) {
    const idx = this._edges.findIndex(
      (e) => e.termA === term || e.termB === term,
    );
    if (idx === -1) return null;

    const { termA, termB, wire } = this._edges[idx];
    termA.connected = null;
    termB.connected = null;
    this._adj.get(termA.id)?.delete(termB.id);
    this._adj.get(termB.id)?.delete(termA.id);
    this._edges.splice(idx, 1);

    this.simulate();
    return wire;
  }

  /** Remove all connections (e.g. clear workspace) */
  clear() {
    for (const e of this._edges) {
      e.termA.connected = null;
      e.termB.connected = null;
    }
    this._edges = [];
    this._adj.clear();
    for (const comp of this._components.values()) {
      for (const t of comp.terminals) this._adj.set(t.id, new Set());
    }
    this.simulate();
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  simulate() {
    // First turn all LEDs off
    for (const comp of this._components.values()) {
      if (comp.type?.startsWith('led_')) {
        comp.light(false);
        comp.setActive(false);
      }
    }

    // Build a terminal-id → Terminal lookup for DFS
    const termById = this._buildTerminalIndex();

    // For each battery, check whether any LED can be lit
    for (const comp of this._components.values()) {
      if (!comp.type?.startsWith('battery_')) continue;

      const posT = comp.terminals.find((t) => t.type === 'positive');
      const negT = comp.terminals.find((t) => t.type === 'negative');
      if (!posT || !negT) continue;

      // Try to light each LED
      for (const led of this._components.values()) {
        if (!led.type?.startsWith('led_')) continue;
        const anodeT   = led.terminals.find((t) => t.type === 'anode');
        const cathodeT = led.terminals.find((t) => t.type === 'cathode');
        if (!anodeT || !cathodeT) continue;

        // Path: posT → … → anodeT (enters LED at anode)
        //       cathodeT → … → negT
        const throughLED =
          this._pathExists(posT.id,    anodeT.id,   termById, new Set()) &&
          this._pathExists(cathodeT.id, negT.id,    termById, new Set());

        if (throughLED) {
          led.light(true);
          led.setActive(true);
        }
      }
    }

    // Dispatch a custom DOM event so main.js can update the UI
    window.dispatchEvent(
      new CustomEvent('circuit:update', {
        detail: { anyLit: this._anyLEDsLit() },
      }),
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Walk the adjacency graph ignoring LED-internal crossing.
   *  We treat each component as a passthrough node:
   *    entering via one terminal you can exit from any other terminal
   *    of the same component (like a wire / junction).
   *  For LEDs we only allow entry at anode and exit at cathode
   *  (handled outside by checking both sub-paths separately).
   */
  _pathExists(fromId, toId, termById, visited) {
    if (fromId === toId) return true;
    if (visited.has(fromId)) return false;
    visited.add(fromId);

    const neighbours = this._adj.get(fromId);
    if (!neighbours) return false;

    for (const nbrId of neighbours) {
      if (visited.has(nbrId)) continue;

      if (nbrId === toId) return true;

      // Traverse through the component that owns nbrId
      const nbrTerm = termById.get(nbrId);
      if (!nbrTerm) continue;

      const nbrComp = this._ownerOf(nbrId);
      if (!nbrComp) continue;

      // Do not pass through an LED (they are directional – handled externally)
      if (nbrComp.type?.startsWith('led_')) {
        // Only allow if nbrId is the exact target
        if (nbrId === toId) return true;
        continue;
      }

      // Exit from every other terminal of this component
      for (const exitTerm of nbrComp.terminals) {
        if (exitTerm.id === nbrId) continue; // don't re-enter
        if (
          this._pathExists(exitTerm.id, toId, termById, new Set(visited))
        ) {
          return true;
        }
      }
    }
    return false;
  }

  _buildTerminalIndex() {
    const map = new Map();
    for (const comp of this._components.values()) {
      for (const t of comp.terminals) map.set(t.id, t);
    }
    return map;
  }

  _ownerOf(termId) {
    for (const comp of this._components.values()) {
      if (comp.terminals.some((t) => t.id === termId)) return comp;
    }
    return null;
  }

  _anyLEDsLit() {
    for (const comp of this._components.values()) {
      if (comp.type?.startsWith('led_') && comp._isLit) return true;
    }
    return false;
  }
}
