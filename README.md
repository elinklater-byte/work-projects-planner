# Work Board

A project-tracking dashboard (Kanban board + tasks/subtasks) with a brainstorm corkboard.

Originally built as a Claude artifact, which persists data through Claude's own
`window.storage` API. That API only exists inside Claude.ai, so this version
swaps it for a `localStorage`-backed shim (`src/storage-shim.js`) that mimics
the same interface — everything else in `App.jsx` is unchanged. Data will be
saved per-browser rather than synced across devices.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Outputs to `dist/`.

## Deploy

Push this folder to a GitHub repo, then import it in Vercel (Framework
Preset: Vite). No environment variables or extra config needed.
