# FIELD × JavaScript — Agent Guide (p5.js & vanilla web)

> **Audience:** an AI coding agent asked to build an interactive p5.js sketch or a
> vanilla-JS web page that reacts to FIELD in real time. This document is the
> complete input/output contract. Follow it literally.

---

## 1. What FIELD gives you

FIELD is a local visual canvas. Physical sensors (a phone, BLE, serial, OSC, MIDI)
send data into FIELD; the user wires that data through rule-based **Cues** to
named **outputs**. FIELD then broadcasts the resulting values over a **local
WebSocket** so any web page can read them.

Your job as a JS author is only to **read numbers and draw**. You never open a raw
WebSocket yourself — you include one small library, `field-bridge.js`, and call its
`field.*` API. **Every value is a number from 0 to 1.**

- **Raw sensor value:** `field.sensor('TILT')` → the phone tilt, 0–1, straight from the device.
- **Cue output value:** `field.get('MOVE')` → the value *after* the user's Mechanism
  (SWITCH / DIAL / LATCH / etc.) has transformed it. Prefer this when the user has
  drawn a Cue; it respects their logic.

---

## 2. Include the library

`field-bridge.js` ships next to this file. Load it before your sketch. The library
infers the FIELD WebSocket URL from its own `src`, so **point the `src` at the
running FIELD app** (the desktop app serves it on `localhost` — default port 5173
in dev, or whatever the app prints).

```html
<!-- Load from the running FIELD app so the WS URL is inferred automatically -->
<script src="http://localhost:5173/field-bridge.js"></script>
```

If you host the page elsewhere and only have a copy of the library, set the URL
explicitly **before** the script tag:

```html
<script>window.FIELD_WS_URL = 'ws://localhost:5173/ws';</script>
<script src="./field-bridge.js"></script>
```

There is no build step, no npm install, no bundler. Plain `<script>` tags.

---

## 3. The `field` API (complete)

The library exposes a single global `field` object. All getters are synchronous and
return the latest value; they never block.

| Call | Returns | Notes |
|---|---|---|
| `field.get('MOVE')` | number 0–1, or `undefined` | Cue output value. `undefined` until data arrives → use `?? 0`. |
| `field.actor('Robot').get('MOVE')` | number 0–1 | Same, scoped to one Actor by name. |
| `field.sensor('TILT')` | number 0–1 | Raw sensor input, no Cue needed. |
| `field.sensor('TOUCH_2')` | number 0–1 | Multi-instance key (3rd TOUCH). See §6. |
| `field.tilt()` | `{ roll, pitch, yaw, alpha, beta, gamma }` or `null` | Raw device orientation, degrees. |
| `field.scene()` | string or `null` | Active Scene name. |
| `field.sceneId()` | string or `null` | Active Scene id. |
| `field.values()` | `{ MOVE: 0.8, GLOW: 0.3, ... }` | Flat copy of all cue outputs. |
| `field.actors()` | `{ Robot: { MOVE: 0.8 }, ... }` | Per-actor copy. |
| `field.sensors()` | `{ TILT: 0.6, SOUND: 0.2, ... }` | Raw sensor copy. |
| `field.on(cb)` | unsubscribe fn | `cb(state)` fires on every update. |
| `field.connected` | boolean | `true` when the WS is open. |

**Rule:** always default missing values — `field.get('GLOW') ?? 0` — because the
first frames render before any sensor packet has arrived.

### Output role names you can read (`field.get(...)`)
`SHOW · HIDE · MOVE · GLOW · SPEAK · RECORD · SEND · LAYER`

### Sensor role names you can read (`field.sensor(...)`)
`PRESENCE · TOUCH · TILT · SHAKE · LIGHT · SOUND · FLOW · CONNECT · BUTTON · SLIDER · TOGGLE`

Semantics worth knowing: `TILT` = `(gamma + 90) / 180`, so **0 = tilted full left,
0.5 = upright, 1 = full right**. `TOGGLE`/`BUTTON` are effectively 0 or 1.

---

## 4. p5.js pattern (canonical)

Read inside `draw()` every frame. Do **not** try to make p5 event-driven off FIELD —
just poll the getters each frame.

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
<script src="http://localhost:5173/field-bridge.js"></script>
<script>
function setup() {
  createCanvas(windowWidth, windowHeight);
  noStroke();
}

function draw() {
  background(13, 12, 10);

  // Cue output if the user wired one, else fall back to the raw sensor.
  const move = field.get('MOVE') ?? field.sensor('TILT') ?? 0.5;
  const glow = field.get('GLOW') ?? 0;

  const x = move * width;                 // 0–1 → across the screen
  const r = 40 + glow * 160;              // 0–1 → size
  fill(124, 58, 237, 60 + glow * 195);    // FIELD violet, brighter with glow
  circle(x, height / 2, r);

  // connection hint
  fill(255); textSize(12); textFont('monospace');
  text(field.connected ? 'FIELD ● live' : 'FIELD ○ waiting…', 16, 24);
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }
</script>
</body>
</html>
```

Key points for the agent:
- Map 0–1 to whatever visual range you need (`* width`, `* 360` for degrees, etc.).
- Clamp only if you compute derived values; FIELD values are already 0–1.
- Use `field.actor(name).get(...)` when the project has several Actors with the
  same output role and you must tell them apart.

---

## 5. Vanilla JS pattern (no p5)

Use `field.on()` to push values into the DOM, or poll with
`requestAnimationFrame`. Event-driven is cleaner for DOM.

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" />
<style>
  body { margin:0; height:100vh; display:grid; place-items:center;
         background:#0d0c0a; font-family:monospace; color:#f5f1e8; }
  #ball { width:120px; height:120px; border-radius:50%;
          background:#7c3aed; transition:transform .05s linear; }
</style>
</head>
<body>
<div id="ball"></div>
<script src="http://localhost:5173/field-bridge.js"></script>
<script>
  const ball = document.getElementById('ball');

  field.on((state) => {
    const move = field.get('MOVE') ?? field.sensor('TILT') ?? 0.5;
    const glow = field.get('GLOW') ?? 0;
    // 0–1 → -200..200 px, and scale with glow
    ball.style.transform =
      `translateX(${(move - 0.5) * 400}px) scale(${1 + glow})`;
    ball.style.opacity = 0.4 + glow * 0.6;
  });
</script>
</body>
</html>
```

`field.on(cb)` returns an unsubscribe function — call it on teardown if you build a
single-page app that mounts/unmounts.

---

## 6. Multi-instance sensors (advanced)

One Actor can carry several roles of the same type (e.g. a 12-pad touch board).
FIELD keys them by suffix:

- 1st `TOUCH` → `'TOUCH'`
- 2nd → `'TOUCH_1'`
- 3rd → `'TOUCH_2'` … nth → `'TOUCH_{n-1}'`

Read them the same way: `field.sensor('TOUCH_3')`. Cue outputs are read by their
output role name (and optionally scoped by actor), not by a suffix.

---

## 7. Under the hood (only if you must open the socket yourself)

You normally do **not** need this — use `field-bridge.js`. But the wire protocol is:

- **URL:** `ws://localhost:5173/ws` (or `wss://` when FIELD serves HTTPS).
- **On connect, send:** `{ "type": "hello", "clientType": "sketch" }`.
  `clientType: "sketch"` receives *both* sensor events and output snapshots.
- **You then receive** JSON messages:

```jsonc
// raw sensor, one per device event
{ "type": "sensor_event", "role": "TILT", "value": 0.62,
  "actorId": "…", "raw": { "alpha": 12, "beta": 4, "gamma": 21 } }

// post-mechanism outputs, broadcast whenever the canvas recomputes
{ "type": "output_snapshot", "projectName": "…", "sceneName": "Intro",
  "sceneId": "…",
  "states": [ { "outputRole": "MOVE", "value": 0.8, "actorId": "…", "actorName": "Robot" } ] }
```

`sensor_event.role` is a **string** (supports multi-instance keys like `"TOUCH_3"`),
not an enum. Values are always numbers 0–1.

---

## 8. Do / Don't for the agent

**Do**
- Read with `field.get()` / `field.sensor()`; default missing values with `?? 0`.
- Treat every value as 0–1 and map it into your own visual range.
- Prefer Cue outputs (`field.get`) over raw sensors when a Cue likely exists.
- Show a small connected/waiting indicator; sensors may not be live yet.

**Don't**
- Don't invent new role names — only the ones listed in §3 exist.
- Don't expect values outside 0–1, and don't send unit conversions back.
- Don't hardcode `localhost:5173` if the user says FIELD runs on another host —
  set `window.FIELD_WS_URL` instead.
- Don't add a build step, framework, or bundler unless the user explicitly asks.
