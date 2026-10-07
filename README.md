# Timeblock

Single-user PWA for planning the week in 15-minute blocks and tracking actuals. See the design doc for the full spec; this repo currently implements **Phases 1-3**.

## Layout

- `app/` Vite + React + TS PWA (HashRouter, Firestore with offline cache)
- `shared/` types, converters, time helpers, blocklist resolver
- `firebase/` `firestore.rules`, indexes, rules tests (emulator)
- `extension/` Chrome MV3 site blocker (`npm run build:ext`, load `extension/dist` unpacked)

## Setup

1. Create a Firebase project (Spark plan), enable **Firestore** and **Auth → Google**.
2. Add `<you>.github.io` and `localhost` to Auth authorized domains.
3. `cp app/.env.example app/.env.local` and fill in the web config.
4. `npm install`

## Develop

```bash
npm run dev                 # app on http://localhost:5173/timeblock/
npm run emulators           # then set VITE_USE_EMULATORS=1
npm run test:rules          # Firestore rules tests (needs Java for the emulator)
npm run typecheck
```

## Deploy

Push to `main`. Set repo **variables** `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and Pages source to **GitHub Actions**. Deploy rules once with `firebase deploy --only firestore`.

The Vite base defaults to `/timeblock/`; CI sets it from the repo name.

## Decisions on the open questions (v1)

- Overlapping blocks are **allowed** (drawn side by side).
- Allow-5-minutes friction: Phase 3.
