// ── Global Configuration ─────────────────────────────────────────────────────
// All tuneable constants in one place.

export const CONFIG = {

  // Workspace dimensions (Three.js world units)
  WORKSPACE: {
    WIDTH:     22,
    DEPTH:     17,
    GRID_SIZE: 0.5,      // snap grid resolution
    GRID_DIVS: 44,       // GridHelper divisions
  },

  // Camera initial position (looking at origin from above-front)
  CAMERA: {
    POSITION: { x: 0, y: 20, z: 16 },
    FOV:      58,
    NEAR:     0.1,
    FAR:      200,
  },

  // Gesture thresholds (MediaPipe normalised 0-1 coords)
  GESTURE: {
    PINCH_THRESHOLD:    0.065,  // thumb-index distance to trigger pinch
    PINCH_HYSTERESIS:   0.085,  // release hysteresis (slightly wider than engage)
    HOVER_RADIUS:       2.2,    // world units – sphere around cursor for hover
    GRAB_RADIUS:        2.5,    // world units – sphere to pick up component
    TERMINAL_RADIUS:    1.4,    // world units – snap radius for wire terminals
    ROTATION_DEADZONE:  0.04,   // radians – min two-hand angle delta to count
  },

  // Coordinate mapping from MediaPipe [0,1] to Three.js world
  // MediaPipe x=0 is LEFT edge of frame, x=1 is RIGHT edge.
  // We MIRROR x so that the user's right hand maps to scene right.
  COORD: {
    X_SCALE:  18,   // maps [0,1] → [-9, 9]
    X_OFFSET: -9,
    Z_SCALE:  14,   // maps [0,1] → [-7, 7]
    Z_OFFSET: -7,
  },

  // Hand cursor visual
  CURSOR: {
    RADIUS_OPEN:   0.18,
    RADIUS_PINCH:  0.28,
    COLOR_OPEN:    0x00e5ff,
    COLOR_PINCH:   0xff6d00,
    RING_RADIUS:   0.38,
    RING_TUBE:     0.04,
  },

  // Component Y positions (height above workbench surface)
  Y: {
    REST:    0.0,
    HOVER:   0.45,
    GRABBED: 2.8,   // higher lift = more dramatic 3-D pickup feel
  },

  // 3-D pickup animation parameters
  PICKUP: {
    SCALE_GRABBED:       1.13,  // component grows slightly when held
    SCALE_LERP:          0.14,
    TILT_FACTOR:         0.30,  // max tilt in radians driven by velocity
    TILT_DAMPING:        0.80,  // how quickly tilt decays when still
    SHADOW_MAX_OPACITY:  0.30,  // opacity when resting
    SHADOW_MIN_OPACITY:  0.07,  // opacity at full grab height
    SHADOW_SPREAD:       0.06,  // shadow grows this much per world-unit of height
  },

  // Wire colours by connection type
  WIRE_COLORS: {
    default:  0xff6d00,
    positive: 0xff2222,
    negative: 0x2244ff,
    ground:   0x222222,
  },

  // Circuit feedback
  CIRCUIT: {
    LED_ON_INTENSITY:  0.95,
    LED_OFF_INTENSITY: 0.08,
    LIGHT_DISTANCE:    4,
    LIGHT_INTENSITY:   2.5,
  },

  // Snap-back animation speed (lerp factor per frame)
  SNAP_LERP: 0.22,
};

// MediaPipe landmark indices
export const LM = {
  WRIST:        0,
  THUMB_CMC:    1,  THUMB_MCP:    2,  THUMB_IP:     3,  THUMB_TIP:    4,
  INDEX_MCP:    5,  INDEX_PIP:    6,  INDEX_DIP:    7,  INDEX_TIP:    8,
  MIDDLE_MCP:   9,  MIDDLE_PIP:  10,  MIDDLE_DIP:  11,  MIDDLE_TIP:  12,
  RING_MCP:    13,  RING_PIP:    14,  RING_DIP:    15,  RING_TIP:    16,
  PINKY_MCP:   17,  PINKY_PIP:   18,  PINKY_DIP:   19,  PINKY_TIP:   20,
};

// Component type strings (single source of truth)
export const CT = {
  BATTERY_9V:   'battery_9v',
  BATTERY_5V:   'battery_5v',
  RESISTOR_220: 'resistor_220',
  RESISTOR_1K:  'resistor_1k',
  RESISTOR_10K: 'resistor_10k',
  LED_RED:      'led_red',
  LED_GREEN:    'led_green',
  LED_BLUE:     'led_blue',
  LED_YELLOW:   'led_yellow',
  BREADBOARD:   'breadboard',
  WIRE:         'wire',
};
