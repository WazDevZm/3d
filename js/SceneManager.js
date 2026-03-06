// ── SceneManager.js ──────────────────────────────────────────────────────────
// Sets up and owns the Three.js scene, camera, renderer, lighting, workbench
// surface, grid, and the hand-cursor indicator meshes.

import * as THREE from 'three';
import { CONFIG } from './config.js';

export class SceneManager {
  /**
   * @param {HTMLElement} container  – element to append the renderer canvas to
   */
  constructor(container) {
    this.container = container;

    // Public refs
    this.scene    = new THREE.Scene();
    this.camera   = null;
    this.renderer = null;

    // Cursor meshes
    this._cursor     = null;
    this._cursorRing = null;

    // Invisible hit plane for world-position raycasting
    this._hitPlane   = null;
    this._raycaster  = new THREE.Raycaster();

    this._init();
  }

  // ── Setup ───────────────────────────────────────────────────────────────

  _init() {
    this._setupRenderer();
    this._setupCamera();
    this._setupLights();
    this._setupWorkbench();
    this._setupCursor();
    this._setupHitPlane();
    window.addEventListener('resize', () => this._onResize());
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace   = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // Background gradient via CSS fallback; set scene bg colour
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.FogExp2(0x0d1117, 0.022);
  }

  _setupCamera() {
    const { innerWidth: W, innerHeight: H } = window;
    const { POSITION, FOV, NEAR, FAR } = CONFIG.CAMERA;
    this.camera = new THREE.PerspectiveCamera(FOV, W / H, NEAR, FAR);
    this.camera.position.set(POSITION.x, POSITION.y, POSITION.z);
    this.camera.lookAt(0, 0, 0);
  }

  _setupLights() {
    // Ambient fill
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambient);

    // Main key light (sun from above-left)
    const key = new THREE.DirectionalLight(0xfff8e0, 0.85);
    key.position.set(6, 24, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left   = -18;
    key.shadow.camera.right  =  18;
    key.shadow.camera.top    =  18;
    key.shadow.camera.bottom = -18;
    key.shadow.camera.far    =  80;
    key.shadow.bias          = -0.001;
    this.scene.add(key);

    // Cool fill from opposite side
    const fill = new THREE.DirectionalLight(0xc0d8ff, 0.3);
    fill.position.set(-8, 12, -8);
    this.scene.add(fill);

    // Rim light from behind
    const rim = new THREE.DirectionalLight(0x80aaff, 0.15);
    rim.position.set(0, 5, -20);
    this.scene.add(rim);
  }

  _setupWorkbench() {
    const { WIDTH, DEPTH, GRID_DIVS } = CONFIG.WORKSPACE;

    // PCB-green surface
    const tableGeo = new THREE.BoxGeometry(WIDTH + 2, 0.3, DEPTH + 2);
    const tableMat = new THREE.MeshPhongMaterial({
      color:     0x1a4a20,
      specular:  0x0a1a0a,
      shininess: 20,
    });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.y = -0.15;
    table.receiveShadow = true;
    this.scene.add(table);

    // Subtle edge border
    const edgeMat = new THREE.MeshPhongMaterial({ color: 0x0f2d12 });
    [
      { g: new THREE.BoxGeometry(WIDTH + 2.4, 0.05, 0.25), p: [0, 0, -(DEPTH / 2 + 1.05)] },
      { g: new THREE.BoxGeometry(WIDTH + 2.4, 0.05, 0.25), p: [0, 0,  (DEPTH / 2 + 1.05)] },
      { g: new THREE.BoxGeometry(0.25, 0.05, DEPTH + 2.2),  p: [-(WIDTH / 2 + 1.05), 0, 0] },
      { g: new THREE.BoxGeometry(0.25, 0.05, DEPTH + 2.2),  p: [ (WIDTH / 2 + 1.05), 0, 0] },
    ].forEach(({ g, p }) => {
      const m = new THREE.Mesh(g, edgeMat);
      m.position.set(...p);
      this.scene.add(m);
    });

    // Grid
    const grid = new THREE.GridHelper(WIDTH, GRID_DIVS, 0x003d08, 0x002505);
    grid.position.y = 0.012;
    this.scene.add(grid);
  }

  _setupCursor() {
    const { RADIUS_OPEN, COLOR_OPEN, RING_RADIUS, RING_TUBE } = CONFIG.CURSOR;

    // Sphere (hand position indicator)
    const sphereGeo = new THREE.SphereGeometry(RADIUS_OPEN, 16, 16);
    this._cursorMat = new THREE.MeshBasicMaterial({
      color:       COLOR_OPEN,
      transparent: true,
      opacity:     0.75,
    });
    this._cursor = new THREE.Mesh(sphereGeo, this._cursorMat);
    this._cursor.visible = false;
    this.scene.add(this._cursor);

    // Ring on the surface plane
    const ringGeo = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 8, 36);
    this._ringMat = new THREE.MeshBasicMaterial({ color: COLOR_OPEN });
    this._cursorRing = new THREE.Mesh(ringGeo, this._ringMat);
    this._cursorRing.rotation.x = Math.PI / 2;
    this._cursorRing.visible = false;
    this.scene.add(this._cursorRing);
  }

  _setupHitPlane() {
    // Invisible horizontal plane at y=0 for raycasting world positions
    const geo = new THREE.PlaneGeometry(200, 200);
    const mat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    this._hitPlane = new THREE.Mesh(geo, mat);
    this._hitPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this._hitPlane);
  }

  // ── Per-frame updates ────────────────────────────────────────────────────

  /** Update the hand cursor position and style in the 3D scene */
  updateCursor(worldPos, isPinching) {
    const { COLOR_OPEN, COLOR_PINCH, RADIUS_OPEN, RADIUS_PINCH } = CONFIG.CURSOR;

    if (!worldPos) {
      this._cursor.visible     = false;
      this._cursorRing.visible = false;
      return;
    }

    this._cursor.visible     = true;
    this._cursorRing.visible = true;

    const color  = isPinching ? COLOR_PINCH : COLOR_OPEN;
    const radius = isPinching ? RADIUS_PINCH : RADIUS_OPEN;

    this._cursorMat.color.setHex(color);
    this._ringMat.color.setHex(color);

    const yOff = isPinching ? 0.55 : 0.45;
    this._cursor.position.set(worldPos.x, yOff, worldPos.z);
    this._cursorRing.position.set(worldPos.x, 0.025, worldPos.z);
    this._cursor.scale.setScalar(radius / CONFIG.CURSOR.RADIUS_OPEN);

    // Pulse ring scale when pinching
    const t = performance.now() / 1000;
    const pulse = isPinching ? 1 + Math.sin(t * 8) * 0.15 : 1;
    this._cursorRing.scale.setScalar(pulse);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const W = window.innerWidth, H = window.innerHeight;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H);
  }
}
