# UX — Praxio

**Design samples are in `planning/design/`. They show visual direction only — not final. Do not derive color, spacing, or typography decisions from them; only derive page structure, component presence, and layout zones.**

---

## Pages

### 1. Landing / Concept Entry

**Route:** `/`

The student's entry point. They arrive here every time — there is no persistent home feed.

**Purpose:** Capture the concept the student is stuck on and kick off generation.

**Key user actions:**
- Type a concept into a text input
- Speak a concept via microphone (ElevenLabs STT — opt-in via mic toggle)
- Submit to trigger `/api/generate`
- Open a recent workspace from the session list

**States:**
- **Idle** — input empty, mic toggle visible
- **Recording** — mic active, live transcription visible in input
- **Error** — generation failed (show retry, no crash)
- **Recent workspaces available** — session-scoped list appears below concept input
- **No recent workspaces** — empty-state copy shown in the same slot

**Recent workspaces panel (Landing)**

- Title: `Recent workspaces`
- Scope: workspaces for current `sessionId` only (no auth, no cross-device sync)
- Sorting: descending by `lastActiveAt` (fallback `createdAt`)
- Grouping: `Today` and `Earlier`
- Row fields: concept, relative time, status badge (`in progress` or `completed`)
- Row actions:
  - `Resume` → `/workspace/[workspaceId]`
  - `Replay last step` (only for completed sessions)
- Empty state: `No recent workspaces yet`

**Navigation out:** On submit → Generation Loading page

---

### 2. Generation Loading

**Route:** `/` (same route, transitional screen — no URL change) or a transient overlay

A full-screen centered page shown immediately after the student submits a concept. Stays visible while generation runs. Replaces the Landing input; student cannot interact.

**Purpose:** Show meaningful real-time progress so the wait feels productive rather than broken.

**Transport:** The client uses `POST /api/generate?stream=1` and consumes NDJSON: `progress_step_*` events drive which row is **active**; **done** rows advance as steps complete. Do not infer step order from fake timers. Optional `attempt` events mirror internal pipeline traces (retries, failures).

**Layout:** Centered column — logo + concept quote → five-step progress list → short status line at bottom.

**Progress steps (labels):**
1. **Curriculum Agent** — design doc core (params, socratic plan, etc.)
2. **Verification Spec Agent** — probes + invariants (includes design-doc consistency in the same UX row)
3. **Sim Builder Agent** — sim code generation + static validation
4. **Behavioral Verify** — probe/invariant checks in headless runtime
5. **Sandbox load** — becomes active on successful API `result` while the app navigates to the workspace. Completion is not shown until the iframe reports `MANIFEST` (simulation runtime ready); the workspace page shows a blocking overlay until then.

**Row states (simplified for implementation):** pending (dim) / active (pulse) / done (check) / failed (if terminal error in that row).

**Status line** reflects generation vs. handoff to the workspace.

**Error:** Failed stages map from `error.phase` on the final stream `error` event; return to Landing with the error message.

**Navigation out:** After `result` (success) → `/workspace/:id` (with optional sessionStorage for unsaved local workspaces)

---

### 3. Workspace

**Route:** `/workspace/[workspaceId]`

The main session view. Vertically stacked layout — simulation fills the screen, tutor lives in a bottom strip. Student spends the entire session here.

**Purpose:** Host the interactive simulation and the Socratic tutor loop.

**Key user actions:**
- Manipulate simulation parameters (sliders in floating ParamPanel)
- Speak or type responses to the tutor (TutorStrip at bottom)
- Toggle microphone (STT on/off) via speak button in TutorStrip
- View current branch and checkpoint count in TopBar

**Layout zones (top to bottom):**
- **TopBar** (44px) — logo, concept title, branch/checkpoint pill, user avatar
- **SimArea** (flex: 1, fills remaining height) — simulation iframe covering the full area; `ParamPanel` floats over it at top-left; agent annotation overlays rendered on top
- **TutorStrip** (80px) — three horizontal sections: waveform/status (left, 180px) | tutor question (center, flex) | student input + speak button (right, 200px)

**States:**
- **Loading sim / sandbox** — full-screen overlay until the first **manifest** is received from the sim iframe (`postMessage`); then controls and tutor are usable
- **Sim ready / staging** — tutor applies initial `lock()` / `highlight()` before first question
- **Active tutor loop** — normal interaction, tutor questions stream
- **Tutor speaking** — TTS playing; waveform animates, status reads `● tutor speaking`
- **Student input** — text field focused or mic active; status reads `● listening`
- **Idle** — no audio activity; waveform flat, status reads `○ idle`
- **Sim idle (episodic)** — sim loaded but not launched; SimControls shows Launch button; sliders live
- **Sim active (episodic)** — flight/run in progress; SimControls shows Pause button
- **Sim done (episodic)** — terminal event fired (ball landed, etc.); SimControls shows Reset button; sliders live for next run
- **Sim paused** — SimControls shows Play icon; waveform stays flat regardless of tutor state
- **Checkpoint restored** — sim rewound, conversation history context updated

**Navigation out:** Back to Landing (new concept). No other pages.

---

## UX Flow

```
Landing
  │
  ├─ [type or speak concept] → submit
  │
  ▼
Generation Loading (full-screen)
  │
  ├─ Step 1: Curriculum agent running → design doc core returned
  ├─ Step 2: Verification-spec agent running → probes/invariants returned
  ├─ Step 3: Sim-builder agent running → sim code returned
  ├─ Step 4: behavioral verification running → invariant report returned
  ├─ Step 5: Sandbox / iframe bridge initializing
  │
  ├─ failure → return to Landing with error
  │
  ▼
Workspace — TopBar + SimArea + TutorStrip
  │
  ▼
Sim loads in iframe (SimArea fills screen)
  │
  ▼
Tutor applies initial staging (lock / highlight) — no speech yet
  │
  ▼
Tutor streams opening Socratic question via TTS
TutorStrip waveform animates, status → "● tutor speaking"
  │
  ▼
┌─────────────────────────────────────┐
│         Active tutor loop           │
│                                     │
│  Student manipulates sim            │
│    → ParamPanel slider change       │
│    → iframe emits PARAM_CHANGED     │
│    → tutor Call 1 (tools/staging)   │
│    → tutor Call 2 (streams speech)  │
│    → TTS plays, waveform animates   │
│                                     │
│  Student speaks / types response    │
│    → TutorStrip input / speak btn   │
│    → STT transcribes (voice path)   │
│    → appended to conversation       │
│    → tutor Call 1 → Call 2          │
│                                     │
│  Branch/checkpoint shown in TopBar  │
└─────────────────────────────────────┘
  │
  ▼
All Socratic steps complete → explicit completion state
  │
  ├─ Tutor emits 1 synthesis turn grounded in student actions
  ├─ Tutor asks 1 transfer question (new condition, same concept)
  ├─ Student answers transfer question (optional but encouraged)
  │
  ├─ Completion actions:
  │    • Try challenge
  │    • Replay step
  │    • New concept
  │
  ▼
Back to Landing (new concept) or replay/challenge in-place
```

---

## Component Tree

### Landing

```
<LandingPage>
  <ConceptInput>
    <TextInput />               ← controlled, submits on Enter or button
    <MicToggle />               ← ElevenLabs STT on/off
    <SubmitButton />
    <LiveTranscript />          ← shown only while mic active
  </ConceptInput>
  <RecentWorkspacesPanel>        ← session-scoped list under ConceptInput
    <WorkspaceRow />             ← concept, updated time, status
    <ResumeButton />
    <ReplayButton />             ← completed-only
  </RecentWorkspacesPanel>
  <ErrorMessage />              ← shown on generation failure (returned from LoadingPage)
</LandingPage>
```

### Generation Loading

```
<GenerationLoadingPage concept={concept}>
  <LogoMark />
  <ConceptQuote />              ← the submitted concept shown in quotes
  <StepList>
    <StepItem                   ← Curriculum Agent — concept → design doc core
      state="pending|active|done"
      label="Curriculum Agent — concept → design doc core"
      snippet={jsonPreview} />
    <StepItem                   ← Verification Spec Agent — probes + invariants
      state="pending|active|done"
      label="Verification Spec Agent — probes + invariants"
      snippet={verificationSpecPreview} />
    <StepItem                   ← Sim Builder Agent — design doc → sim module
      state="pending|active|done"
      label="Sim Builder Agent — design doc → sim module"
      snippet={codePreview} />
    <StepItem                   ← Verify — behavioral invariants
      state="pending|active|done|failed"
      label="Verify — behavioral invariants"
      snippet={verificationPreview} />
    <StepItem                   ← Sandbox iframe runtime loading
      state="pending|active|done"
      label="Sandbox — iframe runtime loading"
      snippet={bridgeStatus} />
  </StepList>
  <StatusLine />                ← "generating simulation via Gemma 4 31B-it…" / "checking model behavior…" / "launching workspace…"
</GenerationLoadingPage>
```

### Workspace

```
<WorkspacePage>
  <TopBar>
    <LogoMark />
    <ConceptTitle />             ← concept string, truncated with ellipsis
    <BranchPill />               ← "◆ main · cp 2/3" — branch name + checkpoint count
    <UserAvatar />
  </TopBar>

  <SimArea>                      ← flex: 1, position: relative, overflow: hidden
    <SimIframe />                ← sandboxed iframe, postMessage bridge, fills SimArea
    <ParamPanel>                 ← absolute positioned, top-left over iframe
      <SliderControl />          ← built dynamically from MANIFEST, one per param
    </ParamPanel>
    <AgentOverlay />             ← highlight / annotation overlays rendered on top of iframe
    <SimControls />              ← absolute positioned, bottom-right over iframe; renders contextually based on manifest flags and current sim phase (see below)
  </SimArea>

  {/* SimControls — button set rendered contextually, bottom-right of SimArea.
      Never draws inside the sim canvas. All four states are mutually exclusive.

      manifest.episodic && phase === 'idle'             → Launch button (blue)
      manifest.animates && phase === 'active' && !paused → Pause button
      manifest.animates && phase === 'active' && paused  → Play button
      manifest.episodic && phase === 'done'             → Reset button (gray)

      For continuous sims (episodic=false): only Pause/Play, no Launch/Reset.
      For static sims (animates=false):     SimControls is not rendered at all.
      phase is tracked in parent state, updated from SIM_PHASE postMessages. */}

  <TutorStrip>                   ← fixed 80px height, border-top, three horizontal sections
    <WaveformSection>            ← 180px wide, left
      <StatusLabel />            ← "● tutor speaking" / "● listening" / "○ idle"
      <Waveform />               ← animated bars, color changes for listening vs speaking
    </WaveformSection>
    <QuestionSection>            ← flex: 1, center
      <TutorQuestion />          ← current tutor question text
      <SimEventHint />           ← "↳ sim event that triggered this" (optional, TBD)
    </QuestionSection>
    <StudentInputSection>        ← 200px wide, right
      <TextInput />              ← "type reply…"
      <SpeakButton />            ← triggers STT mic
    </StudentInputSection>
  </TutorStrip>
</WorkspacePage>
```

---

## Open UX Questions

- **SimEventHint in TutorStrip:** Whether to surface the triggering sim event below the tutor question (the `↳` line) is undecided. It is sent to the tutor but may not need to be shown to the student.
- **Error recovery in Workspace:** If a tutor call fails mid-session, what does the student see? Retry button? Silent retry? Not specified.
- **Generation error recovery:** If curriculum-agent, verification-spec-agent, or sim-builder-agent fails, the LoadingPage should return to Landing with an error message, but the exact error UX (toast, inline, full error state) is not designed.
- **Branch/checkpoint UI:** The Hi-Fi shows branch and checkpoint count in the TopBar pill only. Full branch-switching and checkpoint-restore UX in Workspace remains unresolved; Landing-level workspace resume is now specified.
- **LoadingPage route:** Whether the generation loading screen lives at the same route as Landing (transitional overlay) or a dedicated route (e.g. `/generating`) is TBD in implementation.
- **Completion card density:** Whether post-session completion actions should be a single compact card or a two-step sequence (summary first, actions second) is not yet decided.

## Resolved

- **Params panel placement:** ~~overlaid on top~~ — `ParamPanel` floats over the sim iframe at top-left (absolute positioned). Resolved by Hi-Fi.
- **Generation progress:** ~~single spinner~~ — explicit generation-step rows (curriculum, verification spec, sim builder, sandbox) with active/done states and code snippets. Resolved by Hi-Fi.
- **Workspace layout:** ~~three-panel~~ — vertical stack: TopBar + SimArea (full-width, full-height) + TutorStrip (80px bottom bar). Resolved by Hi-Fi.
