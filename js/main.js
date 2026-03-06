// ── main.js ──────────────────────────────────────────────────────────────────
// Application entry point.
// Wires together: HandTracker → GestureRecognizer → Workspace → SceneManager
// Runs the Three.js animation loop and handles UI events.

import { HandTracker }       from './HandTracker.js';
import { GestureRecognizer } from './GestureRecognizer.js';
import { SceneManager }      from './SceneManager.js';
import { CircuitSim }        from './CircuitSim.js';
import { Workspace }         from './Workspace.js';
import { AIGuide }           from './AIGuide.js';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const video          = document.getElementById('webcam');
const webcamCanvas   = document.getElementById('webcam-canvas');
const sceneContainer = document.getElementById('scene-container');
const statusIcon     = document.getElementById('status-icon');
const statusText     = document.getElementById('status-text');
const gestureIcon    = document.getElementById('gesture-icon');
const gestureLabel   = document.getElementById('gesture-label');
const toastCtn       = document.getElementById('toast-container');
const overlayMsg     = document.getElementById('overlay-message');
const overlayTitle   = document.getElementById('overlay-title');
const overlayBody    = document.getElementById('overlay-body');

// Circuit banner
const circuitBanner    = document.getElementById('circuit-banner');
const circuitBannerLed = document.getElementById('circuit-banner-led');
const circuitBannerTxt = document.getElementById('circuit-banner-text');
const circuitBannerSub = document.getElementById('circuit-banner-sub');

// AI Guide
const aiApiKeyInput = document.getElementById('ai-api-key');
const aiKeySaveBtn  = document.getElementById('ai-key-save');
const aiKeyStatus   = document.getElementById('ai-key-status');
const aiMessages    = document.getElementById('ai-messages');
const aiTextInput   = document.getElementById('ai-text-input');
const aiSendBtn     = document.getElementById('ai-send-btn');
const aiVoiceBtn    = document.getElementById('ai-voice-btn');

// ── Module instances ──────────────────────────────────────────────────────────

let sceneMgr, circuit, workspace, handTracker, gestureRec;
const aiGuide = new AIGuide();
let lastTime = 0;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  try {
    sceneMgr   = new SceneManager(sceneContainer);
    circuit    = new CircuitSim();
    workspace  = new Workspace(sceneMgr.scene, sceneMgr, circuit);
    gestureRec = new GestureRecognizer();

    bindUI();
    window.addEventListener('circuit:update',  (e) => onCircuitUpdate(e.detail));
    window.addEventListener('workspace:toast', (e) => toast(e.detail.msg, e.detail.type));

    requestAnimationFrame(loop);

  } catch (err) {
    console.error('Scene init failed:', err);
    setStatus('err', 'Startup error: ' + err.message);
    showOverlay('&#9888;&#65039;', 'Startup Error',
      err.message + ' — Open the browser console (F12) for details.');
    return;
  }

  setStatus('warn', 'Requesting camera access…');
  showOverlay('&#128247;', 'Allow Camera Access',
    'Click "Allow" when your browser asks for webcam permission. No video leaves your device.');

  if (typeof window.Hands === 'undefined') {
    setStatus('err', 'MediaPipe failed to load – check your internet connection');
    showOverlay('&#9888;&#65039;', 'MediaPipe Not Loaded',
      'The hand-tracking library could not load from the CDN. Check your connection and reload.');
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
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  if (workspace) workspace.tick(currentGestures, dt);
  sceneMgr.render();
}

// ── Hand results callback ─────────────────────────────────────────────────────

let currentGestures = [];

function handleHandResults(results) {
  const landmarks  = results.multiHandLandmarks ?? [];
  const handedness = results.multiHandedness    ?? [];

  if (landmarks.length > 0) {
    currentGestures = gestureRec.recognize(landmarks, handedness);
    updateGestureReadout(currentGestures[0]);
  } else {
    currentGestures = [];
    gestureIcon.textContent  = '&#128400;';
    gestureLabel.textContent = 'No hands detected';
    gestureLabel.parentElement.className = '';
  }
}

function updateGestureReadout(g) {
  if (!g) return;
  const readout = gestureLabel.parentElement;
  if (g.isPinching) {
    gestureIcon.textContent  = '&#128076;';
    gestureLabel.textContent = 'Pinch / Grab';
    readout.className = 'gesture-pinch';
  } else {
    gestureIcon.textContent  = '&#128400;';
    gestureLabel.textContent = 'Hand detected';
    readout.className = 'gesture-open';
  }
}

// ── Circuit feedback ──────────────────────────────────────────────────────────

function onCircuitUpdate({ anyLit }) {
  if (anyLit) {
    circuitBannerLed.className  = 'banner-led on';
    circuitBannerTxt.textContent = 'Circuit complete! ⚡';
    circuitBannerSub.textContent = 'LED loop detected — current is flowing';
    circuitBanner.classList.add('complete');
  } else {
    circuitBannerLed.className  = 'banner-led off';
    circuitBannerTxt.textContent = 'Circuit incomplete';
    circuitBannerSub.textContent = 'Connect battery → resistor → LED to complete the loop';
    circuitBanner.classList.remove('complete');
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

  // Simulate button — force re-run of circuit DFS
  document.getElementById('btn-simulate').addEventListener('click', () => {
    circuit.simulate();
    const btn = document.getElementById('btn-simulate');
    btn.classList.add('running');
    btn.addEventListener('animationend', () => btn.classList.remove('running'), { once: true });
    toast('Simulation updated', 'success');
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

  // Panel tabs
  document.querySelectorAll('.panel-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${target}`)?.classList.add('active');
    });
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key.toLowerCase()) {
      case 's': document.getElementById('btn-select').click();  break;
      case 'w': document.getElementById('btn-wire').click();    break;
      case 'd': document.getElementById('btn-delete').click();  break;
      case 'escape': workspace.setMode('select'); setActiveMode('btn-select'); break;
    }
  });

  // ── AI Guide ────────────────────────────────────────────────────────────

  // Restore saved API key
  const savedKey = localStorage.getItem('vlab_ai_key') ?? '';
  if (savedKey) {
    aiApiKeyInput.value = savedKey;
    aiGuide.setApiKey(savedKey);
    aiKeyStatus.textContent = 'Key loaded from local storage.';
  }

  aiKeySaveBtn.addEventListener('click', saveApiKey);

  aiApiKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveApiKey(); });

  aiSendBtn.addEventListener('click', sendAIMessage);
  aiTextInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAIMessage(); });

  bindVoice();
}

function saveApiKey() {
  const key = aiApiKeyInput.value.trim();
  if (!key.startsWith('sk-ant-')) {
    aiKeyStatus.textContent = 'Invalid key — must start with sk-ant-';
    aiKeyStatus.style.color = 'var(--danger)';
    return;
  }
  localStorage.setItem('vlab_ai_key', key);
  aiGuide.setApiKey(key);
  aiKeyStatus.textContent = 'Key saved ✓';
  aiKeyStatus.style.color = 'var(--accent2)';
  setTimeout(() => {
    aiKeyStatus.style.color = '';
    aiKeyStatus.textContent = 'Key stored locally in your browser.';
  }, 2000);
}

function setActiveMode(btnId) {
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(btnId)?.classList.add('active');
}

// ── AI chat ───────────────────────────────────────────────────────────────────

async function sendAIMessage() {
  const text = aiTextInput.value.trim();
  if (!text) return;
  aiTextInput.value = '';

  appendAIMsg('user', text);
  const thinking = appendAIMsg('assistant thinking', 'Thinking…');

  try {
    const reply = await aiGuide.send(text);
    thinking.remove();
    appendAIMsg('assistant', reply);
  } catch (err) {
    thinking.remove();
    appendAIMsg('assistant', '⚠ ' + err.message);
  }
}

function appendAIMsg(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `ai-msg ai-msg--${role}`;
  const body = document.createElement('div');
  body.className = 'ai-msg-body';
  body.textContent = text;
  wrap.appendChild(body);
  aiMessages.appendChild(wrap);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  return wrap;
}

// ── Voice input ───────────────────────────────────────────────────────────────

function bindVoice() {
  const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!SR) {
    aiVoiceBtn.title         = 'Voice input not supported in this browser';
    aiVoiceBtn.style.opacity = '.35';
    aiVoiceBtn.style.cursor  = 'not-allowed';
    aiVoiceBtn.disabled      = true;
    return;
  }

  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  let listening = false;

  aiVoiceBtn.addEventListener('click', () => {
    if (listening) { rec.stop(); return; }
    rec.start();
  });

  rec.addEventListener('start', () => {
    listening = true;
    aiVoiceBtn.classList.add('listening');
    aiVoiceBtn.title = 'Listening… click to stop';
  });

  rec.addEventListener('end', () => {
    listening = false;
    aiVoiceBtn.classList.remove('listening');
    aiVoiceBtn.title = 'Click to speak';
  });

  rec.addEventListener('result', (e) => {
    const transcript = e.results[0][0].transcript;
    aiTextInput.value = transcript;
    sendAIMessage();
  });

  rec.addEventListener('error', (e) => {
    toast('Voice error: ' + e.error, 'warn');
  });
}

// ── Utility ───────────────────────────────────────────────────────────────────

function setStatus(level, msg) {
  statusIcon.className   = `status-dot ${level}`;
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
  el.className   = `toast ${type}`;
  el.textContent = msg;
  toastCtn.appendChild(el);
  setTimeout(() => {
    el.classList.add('fadeout');
    setTimeout(() => el.remove(), 400);
  }, 3000);
}

// ── Start ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);
