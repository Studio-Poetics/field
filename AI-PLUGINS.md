# FIELD × Custom Hardware — Agent Guide (plugins)

> **Audience:** an AI coding agent asked to add support for a new sensor or actuator
> to FIELD. The deliverable is **one JSON file** named `*.field-plugin.json`. This
> document is the complete input/output contract. Follow it literally — no build
> step, no JavaScript, no `eval`.

---

## 1. The one hard rule

**Plugins do NOT create new roles. They add a hardware driver to a role that
already exists.**

FIELD's model has a fixed set of senses (input roles) and reactions (output roles).
A new sensor IC is not a new role — it is a new *way to drive an existing role*.
Example: an MPR121 capacitive-touch chip is a driver for the existing `TOUCH`
role, not a `MPR121` role. When installed it appears as an option inside the
`TOUCH` role's component selector.

So your first design decision is always: **which existing role does this hardware
extend?**

### Valid `roleId` values (exact strings, all caps)

**Input** (`"kind": "input"`): `PRESENCE  TOUCH  TILT  SHAKE  LIGHT  SOUND  FLOW  CONNECT  BUTTON  SLIDER`

**Output** (`"kind": "output"`): `SHOW  HIDE  MOVE  GLOW  SPEAK  RECORD  SEND  LAYER`

If the hardware doesn't map onto any of these, pick the closest sense/reaction and
say so in the `description`. Do not invent a role.

---

## 2. Output contract: what FIELD generates from your plugin

FIELD compiles a project + its plugins into an Arduino `.ino` sketch. Your plugin
supplies string fragments that FIELD **splices into fixed locations** of that
sketch. The generated sketch talks to FIELD over serial/BLE using this wire format
(newline-terminated JSON, values always 3-decimal):

- Device → FIELD (a sensor reading): `{"role":"TOUCH","value":1.000}`
- FIELD → device (an output command): `{"output":"GLOW","value":0.500}`

Your input plugin's job is to **read the hardware and call `fieldSend(key, value)`**.
Your output plugin's job is to **receive a value and act on the hardware**.
`fieldSend()` and the parser are provided by FIELD's generated scaffold — you only
write the snippets that use them.

---

## 3. File format

```json
{
  "fieldPluginVersion": 1,
  "id": "com.yourname.slug",
  "name": "Human Readable Name",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "One-sentence summary of what this adds.",
  "homepage": "https://link-to-datasheet-or-product",
  "license": "MIT",
  "components": [ /* one or more component objects, see §4 */ ]
}
```

| Field | Required | Notes |
|---|---|---|
| `fieldPluginVersion` | ✓ | Must be `1`. |
| `id` | ✓ | Reverse-domain, globally unique: `com.yourname.slug`. |
| `name` | ✓ | Shown in the Plugin Gallery. |
| `version` | ✓ | Semver. |
| `author` | ✓ | |
| `description` | ✓ | One sentence. |
| `homepage` | — | Datasheet / product page. |
| `license` | — | SPDX id. |
| `components` | ✓ | Array — each extends one role. |

---

## 4. Component object

```json
{
  "roleId": "TOUCH",
  "kind": "input",
  "id": "mpr121",
  "name": "MPR121 (I2C)",
  "description": "Single MPR121 electrode. 1.0 touched, 0.0 released.",
  "wiring": "VIN→3.3V | GND→GND | SDA→SDA | SCL→SCL | ADDR→GND (0x5A)",
  "libraries": ["Adafruit_MPR121"],
  "noMainPin": true,
  "pinType": "analog",
  "extraPins":   [ /* §5 */ ],
  "extraConfig": [ /* §6 */ ],
  "codegen":     { /* §7 */ }
}
```

| Field | Required | Notes |
|---|---|---|
| `roleId` | ✓ | Exact role string from §1. |
| `kind` | ✓ | `"input"` or `"output"`. |
| `id` | ✓ | Unique within this plugin. snake-case. |
| `name` | ✓ | Dropdown label. |
| `description` | — | Shown when selected. |
| `wiring` | — | Short human wiring string. Include it — users rely on it. |
| `libraries` | — | Arduino library names (installed by the one-click uploader). |
| `noMainPin` | — | `true` for I2C/SPI parts with no dedicated Arduino pin. |
| `pinType` | — | Restrict the main pin selector: `"analog"`/`"digital"`/`"pwm"`/`"interrupt"`. |
| `extraPins` | — | Additional pin selectors (§5). |
| `extraConfig` | — | Typed config fields (§6). |
| `codegen` | — | Arduino code fragments (§7). |

---

## 5. `extraPins` — more than one pin

```json
"extraPins": [
  { "key": "csPin",  "label": "CS Pin",  "pinType": "digital" },
  { "key": "intPin", "label": "INT Pin", "pinType": "interrupt" }
]
```
Accessed in codegen as `{{cfg.csPin}}`, `{{cfg.intPin}}`.

---

## 6. `extraConfig` — typed UI fields

```json
"extraConfig": [
  { "key": "i2cAddr", "label": "I2C Address", "type": "select",
    "options": ["0x5A","0x5B","0x5C","0x5D"], "default": "0x5A",
    "hint": "ADDR pin: GND=0x5A, 3V3=0x5B, SDA=0x5C, SCL=0x5D" },
  { "key": "electrode", "label": "Electrode (0–11)", "type": "number",
    "default": 0, "hint": "Which of the 12 pads to read" }
]
```

| Key | Notes |
|---|---|
| `key` | Referenced as `{{cfg.KEY}}` in codegen. |
| `label` | UI label. |
| `type` | `"select"` \| `"number"` \| `"text"`. |
| `options` | Required for `select`. |
| `default` | Pre-filled value. |
| `hint` | Grey subtext. |

---

## 7. `codegen` — Arduino fragments (all fields optional strings)

```json
"codegen": {
  "includes": ["<Wire.h>", "<Adafruit_MPR121.h>"],
  "globals":  "Adafruit_MPR121 mpr_{{varName}};",
  "setup":    "  if (!mpr_{{varName}}.begin({{cfg.i2cAddr}})) { while (1); }",
  "loopRead": "  { uint16_t t = mpr_{{varName}}.touched();\n    fieldSend(\"{{roleEventKey}}\", (t & (1 << {{cfg.electrode}})) ? 1.0f : 0.0f); }"
}
```

| Field | Where it is spliced |
|---|---|
| `includes` | `#include` lines at top of file (array). |
| `globals` | Global declarations, outside all functions. |
| `setup` | Inside `setup()`. |
| `loopRead` | **Input only.** Inside `loop()`; read hardware then call `fieldSend("{{roleEventKey}}", value)`. |
| `outputHandler` | **Output only.** Inside `loop()`; act on a received value for this output role. |

### Template variables (substituted in every codegen string)

| Variable | Value |
|---|---|
| `{{varName}}` | Unique C++ id per role instance, e.g. `a3f2`. **Suffix every global name with it** to avoid collisions across instances. |
| `{{pin}}` | Main pin string: `"A0"`, `"3"`, `"~9"`. Only when `noMainPin` is false. |
| `{{roleType}}` | Base role string: `"TOUCH"`. |
| `{{roleEventKey}}` | **Serial key for this instance — always use this in `fieldSend()`.** 1st instance `"TOUCH"`, 2nd `"TOUCH_1"`, 3rd `"TOUCH_2"`, … |
| `{{cfg.KEY}}` | An `extraConfig` / `extraPins` value. |
| `{{config.KEY}}` | An **output** role's config field value. |

> **Critical for input plugins:** call `fieldSend("{{roleEventKey}}", v)`, never
> `fieldSend("{{roleType}}", v)`. `{{roleType}}` hardcodes the base key and breaks
> multi-instance routing — every copy would collide on one channel.
>
> **Always emit a normalised 0–1 float.** Use `constrain(x, 0.0f, 1.0f)`. FIELD does
> no unit conversion; raw counts must be mapped in your `loopRead`.

---

## 8. Multi-instance sensors

The physical sensor roles (`TOUCH TILT PRESENCE SHAKE LIGHT SOUND FLOW CONNECT
BUTTON SLIDER`) can be added to one Actor many times — that's how a 12-pad board
becomes 12 independent `TOUCH` roles. FIELD keys them `TOUCH`, `TOUCH_1`, `TOUCH_2`…
and `{{roleEventKey}}` resolves to the right one automatically. Because you suffixed
globals with `{{varName}}`, each instance gets its own state. Test with **two
instances on one Actor** before shipping.

---

## 9. Output plugin shape (driving hardware)

For `"kind": "output"`, provide `outputHandler` instead of `loopRead`. FIELD's
scaffold parses `{"output":"GLOW","value":0.5}` and exposes the matched value; your
handler acts on it. Use `{{config.KEY}}` for output-role config and `{{pin}}` for the
main pin.

```json
{
  "roleId": "GLOW", "kind": "output", "id": "ws2812_brightness",
  "name": "WS2812 strip brightness",
  "wiring": "DIN→{{pin}} | 5V→5V | GND→GND",
  "libraries": ["Adafruit_NeoPixel"],
  "extraConfig": [
    { "key": "count", "label": "LED count", "type": "number", "default": 16 }
  ],
  "codegen": {
    "includes": ["<Adafruit_NeoPixel.h>"],
    "globals":  "Adafruit_NeoPixel strip_{{varName}}({{config.count}}, {{pin}}, NEO_GRB + NEO_KHZ800);",
    "setup":    "  strip_{{varName}}.begin(); strip_{{varName}}.show();",
    "outputHandler": "  { uint8_t b = (uint8_t)(value * 255);\n    for (int i=0;i<{{config.count}};i++) strip_{{varName}}.setPixelColor(i, b,b,b);\n    strip_{{varName}}.show(); }"
  }
}
```

---

## 10. How the user installs it

Plugin Gallery (toolbar → Plugins), three ways: paste a **URL** to the raw JSON,
paste the **JSON** directly, or **drag-drop** the `.field-plugin.json` file.
Installed plugins persist in `localStorage` (`field:installed_plugins_v1`).
Distribute by hosting the single JSON file anywhere (e.g. a GitHub raw URL) — no
registry, no build.

---

## 11. Checklist before you output the file

- [ ] `fieldPluginVersion` is `1`.
- [ ] `id` is reverse-domain and unique.
- [ ] Every `roleId` is an **exact** string from §1 (all caps, no typos).
- [ ] `kind` matches (input role → `"input"`, output role → `"output"`).
- [ ] Input `loopRead` calls `fieldSend("{{roleEventKey}}", v)` — not `{{roleType}}`.
- [ ] Emitted values are `constrain(...)`-ed to `0.0f`–`1.0f`.
- [ ] Every global name is suffixed with `{{varName}}`.
- [ ] `libraries` lists real Arduino library names.
- [ ] `wiring` is specific enough to connect without the datasheet.
- [ ] Valid JSON (no comments, no trailing commas).

---

## 12. Minimal working reference

```json
{
  "fieldPluginVersion": 1,
  "id": "com.example.tmp36",
  "name": "TMP36 Temperature",
  "version": "1.0.0",
  "author": "Example",
  "description": "TMP36 analog temperature sensor mapped onto the LIGHT role.",
  "license": "MIT",
  "components": [
    {
      "roleId": "LIGHT",
      "kind": "input",
      "id": "tmp36",
      "name": "TMP36 (analog)",
      "description": "Reads temperature 0–50°C and normalises to 0–1.",
      "wiring": "VCC→3.3V | GND→GND | OUT→{{pin}}",
      "pinType": "analog",
      "codegen": {
        "loopRead": "  { float mv = analogRead({{pin}}) * (3300.0f / 1023.0f);\n    float c = (mv - 500.0f) / 10.0f;\n    fieldSend(\"{{roleEventKey}}\", constrain(c / 50.0f, 0.0f, 1.0f)); }"
      }
    }
  ]
}
```
