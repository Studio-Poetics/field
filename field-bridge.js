/**
 * FIELD Bridge — standalone library for p5.js sketches and any web page
 *
 * Include in your HTML (adjust host/port if FIELD runs elsewhere):
 *   <script src="http://localhost:5173/field-bridge.js"></script>
 *
 * API (matches the `field` object available inside FIELD's built-in Sketch panel):
 *
 *   field.get('MOVE')                     // cue output value 0–1, or undefined if not wired
 *   field.get('GLOW') ?? 0                // default to 0 until data arrives
 *   field.actor('Robot').get('MOVE')      // actor-specific output value
 *   field.sensor('TILT')                  // raw sensor input 0–1, no cue needed
 *   field.sensor('SOUND')                 // raw mic amplitude 0–1
 *   field.tilt()                          // { roll, pitch, yaw, alpha, beta, gamma } or null
 *   field.scene()                         // active scene name (string) or null
 *   field.sceneId()                       // active scene ID or null
 *   field.on(function(state) { ... })     // fires on every update, returns unsubscribe fn
 *   field.values()                        // copy of flat { MOVE: 0.8, GLOW: 0.3, ... }
 *   field.actors()                        // copy of { ActorName: { MOVE: 0.8 }, ... }
 *   field.sensors()                       // copy of raw sensor map { TILT: 0.6, SOUND: 0.2 }
 *   field.connected                       // true when WS is open
 *
 * The host is inferred from the script's own src URL so the library works
 * when loaded from FIELD's dev server without any configuration. If that
 * doesn't resolve to a live server (script copied locally, page opened via
 * file://, desktop app bound to a non-default port), it automatically scans
 * a short range of localhost ports so exported/downloaded sketches still
 * connect with zero setup — no port number to find or type.
 * Override: set window.FIELD_WS_URL before loading this script.
 */
(function () {
  // ── Build the list of WS URLs to try, in order ──────────────────────────────────
  // The desktop app's port isn't fixed (it picks the first free port from 5173
  // up), so a single inferred URL isn't reliable enough on its own — scanning a
  // small local range is what makes a saved/emailed HTML file "just work".
  var PORT_SCAN_RANGE = 10; // 5173..5182 — covers a handful of other apps/instances already on 5173+
  function buildCandidates() {
    if (typeof window !== 'undefined' && window.FIELD_WS_URL) return [window.FIELD_WS_URL];

    var candidates = [];
    var seen = {};
    function add(url) {
      if (!seen[url]) { seen[url] = true; candidates.push(url); }
    }

    // Fast path: script loaded directly from a running FIELD server.
    var scriptSrc = '';
    try { scriptSrc = document.currentScript.src; } catch (_) {}
    if (scriptSrc) {
      try {
        var su = new URL(scriptSrc);
        if (su.protocol !== 'file:' && su.host) {
          add((su.protocol === 'https:' ? 'wss' : 'ws') + '://' + su.host + '/ws');
        }
      } catch (_) {}
    }

    // Page itself served by FIELD (or any http(s) host on the same origin).
    if (typeof location !== 'undefined' && location.protocol !== 'file:' && location.host) {
      add((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws');
    }

    // Fallback: scan default local ports. wss first — the desktop app serves
    // HTTPS; a self-signed cert must be trusted once per port in-browser
    // before this succeeds, but it still needs no manual URL/port entry.
    for (var p = 5173; p < 5173 + PORT_SCAN_RANGE; p++) {
      add('wss://localhost:' + p + '/ws');
      add('ws://localhost:' + p + '/ws');
    }

    return candidates;
  }

  var candidates = buildCandidates();
  var wsUrl = candidates[0];

  // ── Internal state ────────────────────────────────────────────────────────────
  var state = {
    values:    {},   // outputRoleType → max value across all actors (0–1)
    actors:    {},   // actorName → { outputRoleType → value }
    sensors:   {},   // inputRoleType → raw sensor value (0–1)
    tilt:      null, // { roll, pitch, yaw, alpha, beta, gamma } or null
    sceneName: null,
    sceneId:   null,
  };
  var listeners = [];
  var connected = false;

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i]({
          values:    state.values,
          actors:    state.actors,
          sensors:   state.sensors,
          sceneName: state.sceneName,
          sceneId:   state.sceneId,
          tilt:      state.tilt,
        });
      } catch (_) {}
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  var field = {
    /**
     * Returns the current value (0–1) for an output role type, aggregated across
     * all actors (max value wins). Returns undefined if no data has arrived yet.
     * Requires a cue wired in the FIELD canvas.
     *
     * Usage:  var v = field.get('MOVE') ?? 0.5;
     */
    get: function (roleType) {
      var k = String(roleType).toUpperCase();
      return k in state.values ? state.values[k] : undefined;
    },

    /**
     * Returns an actor-scoped accessor so you can read one specific actor's output.
     *
     * Usage:  var v = field.actor('Robot').get('MOVE');
     */
    actor: function (name) {
      return {
        get: function (roleType) {
          var k = String(roleType).toUpperCase();
          var a = state.actors[name] || {};
          return k in a ? a[k] : undefined;
        },
      };
    },

    /**
     * Returns the raw sensor input value (0–1) by role type — no cue wiring needed.
     * Works as soon as a phone or sensor is connected and sending data.
     *
     * Role types: 'TILT', 'SHAKE', 'TOUCH', 'SOUND', 'LIGHT', 'PRESENCE', 'FLOW',
     *             'CONNECT', 'BUTTON', 'SLIDER', 'TOGGLE'
     *
     * Usage:  var t = field.sensor('TILT');   // 0.5 = upright, 0 = full left, 1 = full right
     *         var s = field.sensor('SOUND');  // 0–1 mic amplitude
     */
    sensor: function (roleType) {
      var k = String(roleType).toUpperCase();
      return k in state.sensors ? state.sensors[k] : undefined;
    },

    /**
     * Returns all three raw orientation axes from the phone's DeviceOrientationEvent,
     * or null until the first TILT event arrives.
     *
     * Normalized 0–1:  tilt.roll   (gamma, left/right bank)
     *                  tilt.pitch  (beta,  nose up/down from upright)
     *                  tilt.yaw    (alpha, compass heading)
     * Raw degrees:     tilt.alpha  (0–360, yaw)
     *                  tilt.beta   (−90→+90, pitch)
     *                  tilt.gamma  (−90→+90, roll)
     *
     * Usage:  var t = field.tilt(); if (t) { var roll = t.gamma; }
     */
    tilt: function () {
      return state.tilt ? Object.assign({}, state.tilt) : null;
    },

    /** Returns the active scene name (string), or null when no scene is active. */
    scene: function () { return state.sceneName; },

    /** Returns the active scene ID (string), or null when no scene is active. */
    sceneId: function () { return state.sceneId; },

    /**
     * Register a callback that fires on every update (output snapshot or sensor event).
     * Returns an unsubscribe function.
     *
     * Usage:  var unsub = field.on(function(s) { console.log(s.values); });
     *         unsub(); // stop listening
     */
    on: function (callback) {
      listeners.push(callback);
      return function () {
        var i = listeners.indexOf(callback);
        if (i > -1) listeners.splice(i, 1);
      };
    },

    /** Returns a shallow copy of the flat output values map { MOVE: 0.8, GLOW: 0.3 } */
    values: function () { return Object.assign({}, state.values); },

    /** Returns a shallow copy of the per-actor output map { ActorName: { MOVE: 0.8 } } */
    actors: function () { return Object.assign({}, state.actors); },

    /** Returns a shallow copy of the raw sensor map { TILT: 0.6, SOUND: 0.2 } */
    sensors: function () { return Object.assign({}, state.sensors); },

    /** true while the WebSocket connection to FIELD is open */
    get connected() { return connected; },
  };

  // ── WebSocket connection ──────────────────────────────────────────────────────
  var candidateIndex = 0;
  var locked = false;       // true once a candidate has actually connected
  var scanTimer = null;
  var CONNECT_TIMEOUT = 1200; // ms per candidate while scanning

  function connect() {
    if (!locked && candidateIndex >= candidates.length) candidateIndex = 0; // wrap and retry
    wsUrl = locked ? wsUrl : candidates[candidateIndex];

    var ws = new WebSocket(wsUrl);
    var settled = false;

    if (!locked) {
      scanTimer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (_) {}
        candidateIndex++;
        connect();
      }, CONNECT_TIMEOUT);
    }

    ws.addEventListener('open', function () {
      settled = true;
      clearTimeout(scanTimer);
      locked = true;
      connected = true;
      ws.send(JSON.stringify({
        type: 'handshake',
        clientType: 'sketch',
        clientId: 'field-bridge-' + Math.random().toString(36).slice(2),
      }));
      if (typeof console !== 'undefined') console.log('[FIELD bridge] connected →', wsUrl);
    });

    ws.addEventListener('message', function (evt) {
      var msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }

      // ── Output snapshot: cue outputs from the canvas ──────────────────────────
      if (msg.type === 'output_snapshot') {
        var vals = {};
        var actors = {};
        for (var i = 0; i < msg.states.length; i++) {
          var s = msg.states[i];
          var k = String(s.outputRole).toUpperCase();
          vals[k] = Math.max(vals[k] !== undefined ? vals[k] : 0, s.value);
          if (!actors[s.actorName]) actors[s.actorName] = {};
          actors[s.actorName][k] = s.value;
        }
        state.values    = vals;
        state.actors    = actors;
        state.sceneName = msg.sceneName  !== undefined ? (msg.sceneName  || null) : state.sceneName;
        state.sceneId   = msg.sceneId    !== undefined ? (msg.sceneId    || null) : state.sceneId;
        notify();
      }

      // ── Sensor event: raw input from phone/BLE/OSC ────────────────────────────
      if (msg.type === 'sensor_event') {
        var role = String(msg.role).toUpperCase();
        state.sensors[role] = msg.value;

        // Reconstruct tilt object from raw orientation angles when present
        if (role === 'TILT' && msg.raw && msg.raw.gamma !== undefined) {
          state.tilt = {
            roll:  (msg.raw.gamma + 90) / 180,
            pitch: Math.max(0, Math.min(1, (msg.raw.beta + 90) / 180)),
            yaw:   msg.raw.alpha / 360,
            alpha: msg.raw.alpha,
            beta:  msg.raw.beta,
            gamma: msg.raw.gamma,
          };
        }
        notify();
      }
    });

    ws.addEventListener('close', function () {
      connected = false;
      if (!locked) {
        // Failed fast (e.g. connection refused) — no need to wait out the full
        // per-candidate timeout before trying the next port.
        if (settled) return;
        settled = true;
        clearTimeout(scanTimer);
        candidateIndex++;
        connect();
        return;
      }
      // Was working, server went away (restart, network blip) — keep retrying
      // the same address; if it never comes back the user reloads the page,
      // which restarts discovery from scratch (server may now be on a new port).
      setTimeout(connect, 2000);
    });

    ws.addEventListener('error', function () {
      ws.close();
    });
  }

  connect();
  if (typeof window !== 'undefined') window.field = field;
})();
