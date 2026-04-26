# Praxio

Praxio is an AI learning tool for the exact moment a student says: “I still don’t get this.”

Instead of giving another explanation, Praxio generates a bespoke interactive simulation for the concept, then teaches through Socratic questioning with a voice tutor.

## The Problem

Most AI tutors are still text tutors. They explain well, but students often stay passive.

Deep learning happens when students **predict**, **manipulate**, and **observe**. Praxio is built around that loop.

## What Makes Praxio Different

- **Generates simulations on demand** for the concept the student is stuck on.
- **Behaviorally verifies generated sims** before teaching from them.
- **Tutor has “hands” on the simulation** through function calls (`lock`, `highlight`, `set_param`, etc.), not just chat text.
- **Socratic-first pedagogy**: tutor asks questions and stages discovery instead of dumping answers.

## Core Demo Flow

1. Student enters a concept (voice or text).
2. Praxio generates a design doc + simulation code.
3. Simulation is statically validated and behaviorally verified.
4. Sim loads into a sandboxed iframe runtime.
5. Tutor runs a two-call turn:
   - `POST /api/tutor/stage` (tool calls only): stage the scene
   - `POST /api/tutor/speak` (streaming text only): ask the Socratic move
6. Student manipulates variables, makes predictions, and learns by discovery.

## Why Two Tutor Calls?

In our model testing, combining tools + speech in one call hurt text reliability. Splitting turns into **stage first, speak second** makes interactions deterministic and keeps spoken tutoring reliable.

## Tech Stack

- Next.js 16 App Router + TypeScript
- Vercel AI SDK (`ai`) + `@ai-sdk/google`
- Models:
  - `gemma-4-31b-it` for simulation generation
  - `gemini-2.5-flash` for tutor turns
- MongoDB Atlas (`mongodb` driver, no Mongoose)
- ElevenLabs for STT/TTS
- Multi-renderer sim runtime (`p5`, `canvas2d`, `jsxgraph`, `matter`)

## Local Run

```bash
pnpm install
```

Create `.env.local`:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=
MONGODB_URI=

# Optional debug flags
PRAXIO_DEBUG_GENERATION=0
PRAXIO_LOG_GENERATION_IO=0
PRAXIO_LOG_GENERATION_MAX_CHARS=2000
```

Start:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm lint`
- `pnpm test:unit`

## Build Notes

- Generated sim modules run inside an iframe sandbox through `public/simRuntime.js`.
- Sim code must use the runtime SDK surface (no direct parent DOM/window access).
- Parent app ↔ iframe communication uses typed `postMessage` events from `lib/types.ts`.
