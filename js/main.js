// ── main.js ──────────────────────────────────────────────────────────────────
// Application entry point.
// Wires together: HandTracker → GestureRecognizer → Workspace → SceneManager
// Runs the Three.js animation loop and handles UI events.

import { HandTracker }      from './HandTracker.js';
import { GestureRecognizer } from './GestureRecognizer.js';
import { SceneManager }     from './SceneManager.js';
import { CircuitSim }       from './CircuitSim.js';
import { Workspace }        from './Workspace.js';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const video         = document.getElementById('webcam');
const webcamCanvas  = document.getElementById('webcam-canvas');
const sceneContainer = document.getElementById('scene-container');
const statusIcon    = document.getElementById('status-icon');
const statusText    = document.getElementById('status-text');
const gestureIcon   = document.getElementById('gesture-icon');
const gestureLabel  = document.getElementById('gesture-label');
const circuitLed    = document.getElementById('circuit-led');
const circuitText   = document.getElementById('circuit-text');
const toastCtn      = document.getElementById('toast-container');
const overlayMsg    = document.getElementById('overlay-message');
const overlayTitle  = document.getElementById('overlay-title');
const overlayBody   = document.getElementById('overlay-body');

// ── Module instances ──────────────────────────────────────────────────────────

let sceneMgr, circuit, workspace, handTracker, gestureRec;
let lastTime = 0;
let handsVisible = false;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  try {
    // 1. Scene
    sceneMgr = new SceneManager(sceneContainer);

    // 2. Circuit simulator
    circuit = new CircuitSim();

    // 3. Workspace (seeds demo components)
    workspace = new Workspace(sceneMgr.scene, sceneMgr, circuit);

    // 4. Gesture recognizer (pure math, no async)
    gestureRec = new GestureRecognizer();

    // 5. UI bindings and event listeners (register before async work)
    bindUI();
    window.addEventListener('circuit:update', (e) => onCircuitUpdate(e.detail));
    window.addEventListener('workspace:toast', (e) => toast(e.detail.msg, e.detail.type));

    // 6. Animation loop starts immediately (scene visible before webcam is ready)
    requestAnimationFrame(loop);

  } catch (err) {
    console.error('Scene init failed:', err);
    setStatus('err', 'Startup error: ' + err.message);
    showOverlay('&#9888;&#65039;', 'Startup Error',
      err.message + ' — Open the browser console (F12) for details.');
    return; // abort before trying to start camera
  }

  // 7. Hand tracker (async – needs camera + MediaPipe model download)
  setStatus('warn', 'Requesting camera access…');
  showOverlay('&#128247;', 'Allow Camera Access',
    'Click "Allow" when your browser asks for webcam permission. No video leaves your device.');

  // Guard: MediaPipe must be loaded as a global script before this runs
  if (typeof window.Hands === 'undefined') {
    setStatus('err', 'MediaPipe failed to load – check your internet connection');
    showOverlay('&#9888;&#65039;', 'MediaPipe Not Loaded',
      'The hand-tracking library could not load from the CDN. Check your internet connection and reload.');
    return;
  }

  handTracker = new HandTracker(video, webcamCanvas);
  handTracker.onResults = handleHandResults;

  try {
    await handTracker.initialize();
    setStatus('on', 'Camera active – show your hands!');
    hideOverlay();
    toast('Hand tracking ready! ✋', 'success');
  } catch (err) {
    console.error('HandTracker init failed:', err);
    setStatus('err', 'Camera error – check browser permissions');
    showOverlay('&#9888;&#65039;', 'Camera Not Available',
      (err.message || 'Could not access webcam.') +
      ' Make sure you allowed camera access and are using http://localhost:8000 (not file://).');
  }
}

// ── Animation loop ────────────────────────────────────────────────────────────

function loop(timestamp) {
  requestAnimationFrame(loop);
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap at 50 ms
  lastTime = timestamp;

  // Tick workspace (hand positions already processed via callback)
  if (workspace) workspace.tick(currentGestures, dt);

  sceneMgr.render();
}

// ── Hand results callback (fires ~30 fps from MediaPipe) ─────────────────────

let currentGestures = [];

function handleHandResults(results) {
  const landmarks  = results.multiHandLandmarks  ?? [];
  const handedness = results.multiHandedness     ?? [];

  handsVisible = landmarks.length > 0;

  if (handsVisible) {
    currentGestures = gestureRec.recognize(landmarks, handedness);
    updateGestureReadout(currentGestures[0]);
  } else {
    currentGestures = [];
    gestureIcon.textContent = '&#128400;';
    gestureLabel.textContent = 'No hands detected';
    gestureLabel.parentElement.className = '';
  }
}

function updateGestureReadout(g) {
  if (!g) return;
  const readout = gestureLabel.parentElement;
  if (g.isPinching) {
    gestureIcon.textContent  = '&#128076;'; // pinching hand
    gestureLabel.textContent = 'Pinch / Grab';
    readout.className = 'gesture-pinch';
  } else {
    gestureIcon.textContent  = '&#128400;'; // open hand
    gestureLabel.textContent = `Hand detected`;
    readout.className = 'gesture-open';
  }
}

// ── Circuit feedback ──────────────────────────────────────────────────────────

function onCircuitUpdate({ anyLit }) {
  if (anyLit) {
    circuitLed.className  = 'status-led on';
    circuitText.textContent = 'Circuit complete! ⚡';
  } else {
    circuitLed.className  = 'status-led off';
    circuitText.textContent = 'Circuit incomplete';
  }
}

// ── UI bindings ───────────────────────────────────────────────────────────────

function bindUI() {
  // Mode buttons
  document.getElementById('btn-select').addEventListener('click', () => {
    workspace.setMode('select');
    setActiveMode('btn-select');
  });
  document.getElementById('btn-wire').addEventListener('click', () => {
    workspace.setMode('wire');
    setActiveMode('btn-wire');
    toast('Wire mode: pinch a terminal to start drawing', 'success');
  });
  document.getElementById('btn-delete').addEventListener('click', () => {
    workspace.setMode('delete');
    setActiveMode('btn-delete');
    toast('Delete mode: pinch a component to remove it', 'warn');
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm('Clear the entire workspace?')) {
      workspace.clearAll();
      toast('Workspace cleared', 'warn');
    }
  });

  // Component palette
  document.querySelectorAll('.palette-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      if (type) {
        workspace.addComponent(type);
        toast(`Added ${btn.querySelector('span').textContent}`, 'success');
      }
    });
  });

  // PiP toggle
  document.getElementById('pip-toggle').addEventListener('click', () => {
    const pip = document.getElementById('webcam-pip');
    const collapsed = pip.style.height === '32px';
    pip.style.height = collapsed ? '' : '32px';
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key.toLowerCase()) {
      case 's': document.getElementById('btn-select').click(); break;
      case 'w': document.getElementById('btn-wire').click();   break;
      case 'd': document.getElementById('btn-delete').click(); break;
      case 'escape': workspace.setMode('select'); setActiveMode('btn-select'); break;
    }
  });
}

function setActiveMode(btnId) {
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(btnId)?.classList.add('active');
}

// ── Utility ───────────────────────────────────────────────────────────────────

function setStatus(level, msg) {
  statusIcon.className = `status-dot ${level}`;
  statusText.textContent = msg;
}

function showOverlay(icon, title, body) {
  document.getElementById('overlay-icon').innerHTML = icon;
  overlayTitle.textContent = title;
  overlayBody.textContent  = body;
  overlayMsg.classList.remove('hidden');
}

function hideOverlay() {
  overlayMsg.classList.add('hidden');
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastCtn.appendChild(el);
  setTimeout(() => {
    el.classList.add('fadeout');
    setTimeout(() => el.remove(), 400);
  }, 3000);
}

// ── Start ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);
