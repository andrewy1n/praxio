# Workspace V2 — design tokens

Extracted from [`Workspace V2 Hifi.html`](./Workspace%20V2%20Hifi.html) (`:root`, embedded styles, and inline values). Use these as the single reference when aligning the app to the hi-fi mock.

---

## Fonts

| Token | Value |
|--------|--------|
| **Sans** | `DM Sans`, sans-serif |
| **Mono** | `DM Mono`, monospace |

Google Fonts load: DM Sans (300, 400, 500, 600 + italic 400); DM Mono (400, 500).

---

## Colors

### Core palette (`:root`)

| Token | CSS variable | Value |
|--------|----------------|--------|
| Background | `--bg` | `#ffffff` |
| Surface | `--surface` | `#f9f9f9` |
| Surface alt | `--surface2` | `#f3f3f1` |
| Border | `--border` | `#e6e6e4` |
| Border strong | `--border-strong` | `#d0d0cc` |
| Ink primary | `--ink` | `#111110` |
| Ink secondary | `--ink2` | `#555552` |
| Ink tertiary | `--ink3` | `#999994` |
| Ink quaternary | `--ink4` | `#c8c8c4` |

### Accent (blue, OKLCH)

| Token | CSS variable | Value |
|--------|----------------|--------|
| Accent | `--accent` | `oklch(50% 0.14 232)` |
| Accent mid | `--accent-mid` | `oklch(60% 0.12 232)` |
| Accent light (fills) | `--accent-light` | `oklch(96% 0.03 232)` |
| Accent border | `--accent-border` | `oklch(80% 0.07 232)` |

### Yellow / annotation (OKLCH)

| Token | CSS variable | Value |
|--------|----------------|--------|
| Yellow | `--yellow` | `oklch(72% 0.14 82)` |
| Yellow light | `--yellow-light` | `oklch(96% 0.04 82)` |
| Yellow border | `--yellow-border` | `oklch(82% 0.10 82)` |

### Semantic / state (inline in mock)

| Usage | Value |
|--------|--------|
| Listening (status, waveform) | `oklch(55% 0.15 30)` |
| Processing spinner | `oklch(68% 0.14 82)` |
| Current checkpoint row bg | `oklch(97% 0.04 82)` |
| Current checkpoint label | `oklch(52% 0.12 82)` |
| Avatar gradient | `linear-gradient(135deg, oklch(75% 0.12 280), oklch(65% 0.14 240))` |

### Sim canvas / illustration

| Usage | Value |
|--------|--------|
| Dot grid fill | `#d4d4cc` (1px dots) |
| Canvas wash | `#fafaf8` |
| Diagram strokes (muted) | `#c8c8c0`, `#b0b0a8`, `#b8b8b0` |

### Overlays & UI chrome

| Usage | Value |
|--------|--------|
| Top bar frosted bg | `rgba(255, 255, 255, 0.92)` + `backdrop-filter: blur(12px)` |
| Param panel bg | `rgba(255, 255, 255, 0.97)` |
| Primary text on accent buttons | `white` |
| Mic button hover (ink control) | `#333` |

---

## Type scale

Sizes observed in the mock (px). Weights: **400** body, **500** emphasis / UI, **600** brand / labels / strong.

| Step | Size (px) | Typical use |
|------|-----------|-------------|
| xs | 9 | Branch pill diamond |
| 2xs | 10 | Uppercase section labels, badges (“active”, “now”), timestamps, footer hints, sim label, diagram mono |
| sm | 11 | Branch UI, status line, mono metadata, slider readouts, waveform row |
| base | 12 | Branch pill text, inputs, param rows, annotation bubble, checkpoint labels |
| md | 13 | Concept title (top bar), sim control button |
| lg | 14 | Wordmark “Praxio”, tutor question line |

### Letter spacing

| Context | Value |
|---------|--------|
| Default UI | `-0.01em` (brand, question) |
| Uppercase labels | `0.06em` – `0.08em` (`Sim · …`, `Parameters`, `Branches`) |
| Tight uppercase | `0.07em` (`Branches` header) |

### Line height

| Context | Value |
|---------|--------|
| Tutor question | `1.45` |
| Annotation bubble | `1.4` |

---

## Measure / readable widths

| Token | CSS variable | Value | Use |
|--------|----------------|--------|-----|
| **Measure lg** | `--measure-lg` | `65ch` | Max width for readable prose blocks (Socratic questions, tutor messages, long-form copy) |

---

## Spacing & layout

### Radius (`:root`)

| Token | Value |
|--------|--------|
| `--r` | `6px` |
| `--r-sm` | `4px` |

Additional radii used inline: **5px** (logo tile), **8px** (dropdown), **10px** / **20px** (pills / badges), **50%** (avatars, dots).

### Shadows (`:root`)

| Token | Value |
|--------|--------|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)` |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.05)` |
| `--shadow-xl` | `0 16px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)` |

Annotation tooltip (inline): `0 2px 8px rgba(0,0,0,0.08)`.

### Structural heights / widths

| Region | Value |
|--------|--------|
| Top bar height | `44px` |
| Tutor strip height | `140px` |
| Tutor strip — status column | `180px` |
| Tutor strip — input column | `200px` |
| Logo mark | `22×22px` |
| Avatar | `26×26px` |
| Input / icon button | `34px` tall |
| Branch dropdown width | `260px` |
| Branch dropdown max list height | `320px` |
| Param panel min width | `228px` |

### Tutor strip column tokens (new)

| Token | Value | Use |
|------|-------|-----|
| `--tutor-strip-h` | `140px` | Tutor strip height |
| `--tutor-status-w` | `180px` | Tutor strip status column (left) |
| `--tutor-input-w` | `380px` | Tutor strip input column (right) |

### Spacing scale (recurring px)

| Value | Examples |
|--------|-----------|
| 1–3 | Micro gaps, pill padding tweaks |
| 4–8 | Compact padding, small gaps |
| 10–14 | Section padding, control gaps, panel padding |
| 16 | Top bar horizontal padding; sim panel offset |
| 20 | Tutor center block horizontal padding |

### Sim area

| Token | Value |
|--------|--------|
| Dot grid | `24px × 24px` cell, 1px dot |

### Z-index (from mock)

| Layer | Value |
|--------|--------|
| Sim controls / param panel | `20` |
| Top bar / tutor strip | `100` |
| Branch dropdown | `200` |

---

## Motion (reference)

| Name | Role |
|------|------|
| `wave` | Waveform bars |
| `pulse` | Live status dot |
| `spin` | Processing state |
| `fadeIn` | Annotation appear |
| `scaleIn` | Dropdown open |

---

## CSS snippet (copy-paste parity with mock)

```css
:root {
  --bg: #ffffff;
  --surface: #f9f9f9;
  --measure-lg: 65ch;
  --surface2: #f3f3f1;
  --border: #e6e6e4;
  --border-strong: #d0d0cc;
  --ink: #111110;
  --ink2: #555552;
  --ink3: #999994;
  --ink4: #c8c8c4;
  --accent: oklch(50% 0.14 232);
  --accent-mid: oklch(60% 0.12 232);
  --accent-light: oklch(96% 0.03 232);
  --accent-border: oklch(80% 0.07 232);
  --yellow: oklch(72% 0.14 82);
  --yellow-light: oklch(96% 0.04 82);
  --yellow-border: oklch(82% 0.10 82);
  --tutor-strip-h: 140px;
  --tutor-status-w: 180px;
  --tutor-input-w: 380px;
  --r: 6px;
  --r-sm: 4px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.05);
  --shadow-xl: 0 16px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06);
}
```
# Workspace V2 — design tokens

Extracted from [`Workspace V2 Hifi.html`](./Workspace%20V2%20Hifi.html) (`:root`, embedded styles, and inline values). Use these as the single reference when aligning the app to the hi-fi mock.

---

## Fonts

| Token | Value |
|--------|--------|
| **Sans** | `DM Sans`, sans-serif |
| **Mono** | `DM Mono`, monospace |

Google Fonts load: DM Sans (300, 400, 500, 600 + italic 400); DM Mono (400, 500).

---

## Colors

### Core palette (`:root`)

| Token | CSS variable | Value |
|--------|----------------|--------|
| Background | `--bg` | `#ffffff` |
| Surface | `--surface` | `#f9f9f9` |
| Surface alt | `--surface2` | `#f3f3f1` |
| Border | `--border` | `#e6e6e4` |
| Border strong | `--border-strong` | `#d0d0cc` |
| Ink primary | `--ink` | `#111110` |
| Ink secondary | `--ink2` | `#555552` |
| Ink tertiary | `--ink3` | `#999994` |
| Ink quaternary | `--ink4` | `#c8c8c4` |

### Accent (blue, OKLCH)

| Token | CSS variable | Value |
|--------|----------------|--------|
| Accent | `--accent` | `oklch(50% 0.14 232)` |
| Accent mid | `--accent-mid` | `oklch(60% 0.12 232)` |
| Accent light (fills) | `--accent-light` | `oklch(96% 0.03 232)` |
| Accent border | `--accent-border` | `oklch(80% 0.07 232)` |

### Yellow / annotation (OKLCH)

| Token | CSS variable | Value |
|--------|----------------|--------|
| Yellow | `--yellow` | `oklch(72% 0.14 82)` |
| Yellow light | `--yellow-light` | `oklch(96% 0.04 82)` |
| Yellow border | `--yellow-border` | `oklch(82% 0.10 82)` |

### Semantic / state (inline in mock)

| Usage | Value |
|--------|--------|
| Listening (status, waveform) | `oklch(55% 0.15 30)` |
| Processing spinner | `oklch(68% 0.14 82)` |
| Current checkpoint row bg | `oklch(97% 0.04 82)` |
| Current checkpoint label | `oklch(52% 0.12 82)` |
| Avatar gradient | `linear-gradient(135deg, oklch(75% 0.12 280), oklch(65% 0.14 240))` |

### Sim canvas / illustration

| Usage | Value |
|--------|--------|
| Dot grid fill | `#d4d4cc` (1px dots) |
| Canvas wash | `#fafaf8` |
| Diagram strokes (muted) | `#c8c8c0`, `#b0b0a8`, `#b8b8b0` |

### Overlays & UI chrome

| Usage | Value |
|--------|--------|
| Top bar frosted bg | `rgba(255, 255, 255, 0.92)` + `backdrop-filter: blur(12px)` |
| Param panel bg | `rgba(255, 255, 255, 0.97)` |
| Primary text on accent buttons | `white` |
| Mic button hover (ink control) | `#333` |

---

## Type scale

Sizes observed in the mock (px). Weights: **400** body, **500** emphasis / UI, **600** brand / labels / strong.

| Step | Size (px) | Typical use |
|------|-----------|-------------|
| xs | 9 | Branch pill diamond |
| 2xs | 10 | Uppercase section labels, badges (“active”, “now”), timestamps, footer hints, sim label, diagram mono |
| sm | 11 | Branch UI, status line, mono metadata, slider readouts, waveform row |
| base | 12 | Branch pill text, inputs, param rows, annotation bubble, checkpoint labels |
| md | 13 | Concept title (top bar), sim control button |
| lg | 14 | Wordmark “Praxio”, tutor question line |

### Letter spacing

| Context | Value |
|---------|--------|
| Default UI | `-0.01em` (brand, question) |
| Uppercase labels | `0.06em` – `0.08em` (`Sim · …`, `Parameters`, `Branches`) |
| Tight uppercase | `0.07em` (`Branches` header) |

### Line height

| Context | Value |
|---------|--------|
| Tutor question | `1.45` |
| Annotation bubble | `1.4` |

---

## Measure / readable widths

| Token | CSS variable | Value | Use |
|--------|----------------|--------|-----|
| **Measure lg** | `--measure-lg` | `65ch` | Max width for readable prose blocks (Socratic questions, tutor messages, long-form copy) |

---

## Spacing & layout

### Radius (`:root`)

| Token | Value |
|--------|--------|
| `--r` | `6px` |
| `--r-sm` | `4px` |

Additional radii used inline: **5px** (logo tile), **8px** (dropdown), **10px** / **20px** (pills / badges), **50%** (avatars, dots).

### Shadows (`:root`)

| Token | Value |
|--------|--------|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)` |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.05)` |
| `--shadow-xl` | `0 16px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)` |

Annotation tooltip (inline): `0 2px 8px rgba(0,0,0,0.08)`.

### Structural heights / widths

| Region | Value |
|--------|--------|
| Top bar height | `44px` |
| Tutor strip height | `80px` |
| Tutor strip — status column | `180px` |
| Tutor strip — input column | `200px` |
| Logo mark | `22×22px` |
| Avatar | `26×26px` |
| Input / icon button | `34px` tall |
| Branch dropdown width | `260px` |
| Branch dropdown max list height | `320px` |
| Param panel min width | `228px` |

### Spacing scale (recurring px)

| Value | Examples |
|--------|-----------|
| 1–3 | Micro gaps, pill padding tweaks |
| 4–8 | Compact padding, small gaps |
| 10–14 | Section padding, control gaps, panel padding |
| 16 | Top bar horizontal padding; sim panel offset |
| 20 | Tutor center block horizontal padding |

### Sim area

| Token | Value |
|--------|--------|
| Dot grid | `24px × 24px` cell, 1px dot |

### Z-index (from mock)

| Layer | Value |
|--------|--------|
| Sim controls / param panel | `20` |
| Top bar / tutor strip | `100` |
| Branch dropdown | `200` |

---

## Motion (reference)

| Name | Role |
|------|------|
| `wave` | Waveform bars |
| `pulse` | Live status dot |
| `spin` | Processing state |
| `fadeIn` | Annotation appear |
| `scaleIn` | Dropdown open |

---

## CSS snippet (copy-paste parity with mock)

```css
:root {
  --bg: #ffffff;
  --surface: #f9f9f9;
  --measure-lg: 65ch;
  --surface2: #f3f3f1;
  --border: #e6e6e4;
  --border-strong: #d0d0cc;
  --ink: #111110;
  --ink2: #555552;
  --ink3: #999994;
  --ink4: #c8c8c4;
  --accent: oklch(50% 0.14 232);
  --accent-mid: oklch(60% 0.12 232);
  --accent-light: oklch(96% 0.03 232);
  --accent-border: oklch(80% 0.07 232);
  --yellow: oklch(72% 0.14 82);
  --yellow-light: oklch(96% 0.04 82);
  --yellow-border: oklch(82% 0.10 82);
  --r: 6px;
  --r-sm: 4px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.05);
  --shadow-xl: 0 16px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06);
}
```
