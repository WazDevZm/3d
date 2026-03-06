// ── HandTracker.js ───────────────────────────────────────────────────────────
// Wraps MediaPipe Hands.  Initialises the webcam, runs inference on every
// frame, and exposes the raw landmark results via a callback.
//
// Dependencies (loaded as global scripts before this module):
//   @mediapipe/hands          → window.Hands, window.HAND_CONNECTIONS
//   @mediapipe/camera_utils   → window.Camera
//   @mediapipe/drawing_utils  → window.drawConnectors, window.drawLandmarks

export class HandTracker {
  /**
   * @param {HTMLVideoElement} videoEl
   * @param {HTMLCanvasElement} overlayCanvas  – PiP canvas for visualisation
   */
  constructor(videoEl, overlayCanvas) {
    this.video   = videoEl;
    this.canvas  = overlayCanvas;
    this.ctx     = overlayCanvas.getContext('2d');

    /** Latest MediaPipe results object. Read externally if needed. */
    this.latestResults = null;

    /** Called every frame with the latest results: (results) => void */
    this.onResults = null;

    this._hands  = null;
    this._camera = null;
    this._ready  = false;
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  async initialize() {
    if (!window.Hands) throw new Error('MediaPipe Hands not loaded');

    this._hands = new window.Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`,
    });

    this._hands.setOptions({
      maxNumHands:            2,
      modelComplexity:        1,       // 0=lite, 1=full
      minDetectionConfidence: 0.70,
      minTrackingConfidence:  0.55,
    });

    this._hands.onResults((results) => this._handleResults(results));

    // Camera utility drives the inference loop
    this._camera = new window.Camera(this.video, {
      onFrame: async () => {
        if (this._hands) {
          await this._hands.send({ image: this.video });
        }
      },
      width:  640,
      height: 480,
    });

    await this._camera.start();
    this._ready = true;
  }

  isReady() { return this._ready; }

  dispose() {
    this._ready = false;
    if (this._camera) this._camera.stop();
    if (this._hands)  this._hands.close();
    this._camera = null;
    this._hands  = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _handleResults(results) {
    this.latestResults = results;

    // Draw mirrored webcam feed to the PiP canvas
    this._drawPiP(results);

    if (this.onResults) this.onResults(results);
  }

  _drawPiP(results) {
    const { canvas: cv, ctx } = this;
    const src = results.image;
    if (!src) return;

    // Match canvas to source dimensions
    cv.width  = src.videoWidth  || src.width  || 640;
    cv.height = src.videoHeight || src.height || 480;

    // Mirror (flip horizontally) so the feed looks like a mirror
    ctx.save();
    ctx.translate(cv.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    ctx.restore();

    // Overlay skeleton landmarks
    if (results.multiHandLandmarks && window.drawConnectors && window.HAND_CONNECTIONS) {
      for (const landmarks of results.multiHandLandmarks) {
        // Remap x coords for mirrored display
        const mirrored = landmarks.map((lm) => ({ ...lm, x: 1 - lm.x }));

        window.drawConnectors(ctx, mirrored, window.HAND_CONNECTIONS, {
          color:     '#00ff88',
          lineWidth: 1.5,
        });
        window.drawLandmarks(ctx, mirrored, {
          color:     '#ff4444',
          lineWidth: 1,
          radius:    2.5,
        });
      }
    }
  }
}
