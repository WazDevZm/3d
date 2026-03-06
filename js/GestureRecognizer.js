// ── GestureRecognizer.js ─────────────────────────────────────────────────────
// Converts raw MediaPipe landmark arrays into high-level gesture objects that
// the Workspace can consume.
//
// Output shape per hand:
// {
//   isPinching:    boolean,
//   pinchStrength: 0-1,          // 1 = fully pinched
//   palmCenter:    {x,y,z},      // world-space, on workspace plane (y≈0)
//   pinchPoint:    {x,y,z},      // mid-point of thumb+index tips
//   indexTip:      {x,y,z},
//   thumbTip:      {x,y,z},
//   indexExtended: boolean,
//   handLabel:     'Left'|'Right'|undefined,
//   raw:           landmarks[],  // original mediapipe landmarks
// }

import { CONFIG, LM } from './config.js';

export class GestureRecognizer {
  constructor() {
    // Per-hand pinch state (hysteresis)
    this._pinching = [false, false];
  }

  /**
   * @param {Array<Array<{x,y,z}>>} multiHandLandmarks
   * @param {Array<{label:string}>}  multiHandedness
   * @returns {Array<Object>} gesture objects, one per hand
   */
  recognize(multiHandLandmarks, multiHandedness = []) {
    const gestures = [];

    for (let i = 0; i < multiHandLandmarks.length; i++) {
      const lm    = multiHandLandmarks[i];
      const label = multiHandedness[i]?.label;
      const g     = this._analyseHand(lm, label, i);
      gestures.push(g);
    }

    return gestures;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _analyseHand(lm, label, idx) {
    const thumbTip  = lm[LM.THUMB_TIP];
    const indexTip  = lm[LM.INDEX_TIP];
    const middleTip = lm[LM.MIDDLE_TIP];

    // Pinch = normalised 2D distance between thumb tip and index tip
    const pinchDist = this._dist2(thumbTip, indexTip);

    // Hysteresis: engage at PINCH_THRESHOLD, release at PINCH_HYSTERESIS
    const wasPin = this._pinching[idx];
    let isPinching;
    if (wasPin) {
      isPinching = pinchDist < CONFIG.GESTURE.PINCH_HYSTERESIS;
    } else {
      isPinching = pinchDist < CONFIG.GESTURE.PINCH_THRESHOLD;
    }
    this._pinching[idx] = isPinching;

    const pinchStrength = Math.max(
      0,
      1 - pinchDist / CONFIG.GESTURE.PINCH_THRESHOLD
    );

    // Palm centre = average of wrist + 4 MCP knuckles
    const palmLandmarks = [
      lm[LM.WRIST],
      lm[LM.INDEX_MCP],
      lm[LM.MIDDLE_MCP],
      lm[LM.RING_MCP],
      lm[LM.PINKY_MCP],
    ];
    const palmNorm = this._avg(palmLandmarks);

    // Finger extension (tip.y < mcp.y means finger is raised in image space)
    const indexExtended  = lm[LM.INDEX_TIP].y  < lm[LM.INDEX_MCP].y;
    const middleExtended = lm[LM.MIDDLE_TIP].y < lm[LM.MIDDLE_MCP].y;

    // Map to world coordinates
    const palmCenter  = this._toWorld(palmNorm);
    const pinchPoint  = this._toWorld(this._avg([thumbTip, indexTip]));
    const indexWorld  = this._toWorld(indexTip);
    const thumbWorld  = this._toWorld(thumbTip);
    const middleWorld = this._toWorld(middleTip);

    return {
      isPinching,
      pinchStrength,
      palmCenter,
      pinchPoint,
      indexTip:      indexWorld,
      thumbTip:      thumbWorld,
      middleTip:     middleWorld,
      indexExtended,
      middleExtended,
      handLabel:     label,
      raw:           lm,
    };
  }

  // 2-D normalised distance (z depth from MediaPipe is less reliable)
  _dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _avg(pts) {
    const n = pts.length;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
      z: pts.reduce((s, p) => s + (p.z ?? 0), 0) / n,
    };
  }

  /**
   * Convert a MediaPipe landmark {x,y,z} (normalised, 0-1) to Three.js
   * world-space coordinates on the workspace plane (world y = 0).
   *
   * MediaPipe x increases left-to-right.
   * We MIRROR x so the interaction feels natural (mirror-like).
   */
  _toWorld(pt) {
    const { X_SCALE, X_OFFSET, Z_SCALE, Z_OFFSET } = CONFIG.COORD;
    return {
      x: (1 - pt.x) * X_SCALE + X_OFFSET,
      y: 0,
      z: pt.y        * Z_SCALE + Z_OFFSET,
    };
  }
}
