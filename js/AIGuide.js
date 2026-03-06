// ── AIGuide.js ────────────────────────────────────────────────────────────────
// Wraps the Anthropic Messages API for in-browser circuit guidance.
// Keeps a rolling conversation history so the AI remembers context.

const SYSTEM_PROMPT = `You are a friendly electronics lab assistant helping beginners build circuits in a virtual 3D lab.

The lab has these components:
- Batteries: 9V Battery, 5V Supply (terminals: positive, negative)
- Resistors: 220Ω, 1kΩ, 10kΩ (terminals: a, b — bidirectional)
- LEDs: Red, Green, Blue, Yellow (terminals: anode +, cathode −)
- Breadboard (for organising connections)
- Wires (drawn by pinching terminals together)

How the lab works:
- Users grab components with a pinch gesture and drag them around
- In Wire mode they pinch a terminal and drag to another terminal to connect
- The circuit simulator checks for completed loops: battery(+) → resistor → LED(anode) → LED(cathode) → battery(−)
- When the loop is complete the LED lights up automatically

Your role:
- Guide beginners step by step, keeping instructions short and numbered
- When asked to build a circuit, describe EXACTLY which components to add and which terminals to connect
- Use plain language — no jargon without explanation
- Be encouraging; celebrate when the circuit works
- If the user says "it's not working", ask which step they are on and offer to troubleshoot
- Never write long essays — keep responses under 120 words`;

export class AIGuide {
  constructor() {
    this._apiKey = '';
    this._history = [];
  }

  setApiKey(key) {
    this._apiKey = key.trim();
  }

  hasKey() {
    return this._apiKey.startsWith('sk-ant-');
  }

  /** Send a user message and return the assistant reply string. */
  async send(userText) {
    if (!this.hasKey()) {
      throw new Error('Please enter your Claude API key in the AI Guide tab first.');
    }

    this._history.push({ role: 'user', content: userText });

    const body = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   this._history,
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':                            'application/json',
        'x-api-key':                               this._apiKey,
        'anthropic-version':                       '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message ?? `HTTP ${res.status}`;
      // Remove the user message so the history stays consistent
      this._history.pop();
      throw new Error(msg);
    }

    const data = await res.json();
    const reply = data.content?.[0]?.text ?? '(no response)';
    this._history.push({ role: 'assistant', content: reply });

    // Keep history to last 20 turns to avoid token bloat
    if (this._history.length > 20) this._history = this._history.slice(-20);

    return reply;
  }

  /** Clear conversation history (new session). */
  reset() {
    this._history = [];
  }
}
