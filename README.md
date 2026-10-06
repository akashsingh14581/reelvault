# ◉ ReelVault

**Private video sharing, by Akash Singh.**
Upload a video → get a link → share → watch → it expires and is deleted automatically.

Stack: React (Vite) · Express · MongoDB · Cloudinary. Deploys as a single free-tier web service (Render).

> **Assumptions.** The original spec sections 1–28 were not available when this was built, so the backend rules were inferred: single owner login, share links with a per-video `expiresAt`, a maximum of 3 simultaneous viewers, MongoDB + Cloudinary storage, Render hosting. Everything configurable lives in environment variables.

## Features

- **Resumable chunked upload** straight from the browser to Cloudinary (10 MB chunks, exponential-backoff retries, offline detection, pause/resume/cancel, progress + speed + ETA).
- **Refresh recovery:** progress is saved locally; after an accidental refresh, choose the same file and upload continues from the last confirmed chunk.
- **Duplicate detection** using a cheap client-side fingerprint (size + hash of first/last 1 MB) — you get a choice, nothing is replaced silently.
- **Processing pipeline:** non-browser-friendly sources (MKV, HEVC, AVI…) are converted to H.264/AAC MP4 by Cloudinary. States: `UPLOADING → PROCESSING → READY`, plus `FAILED`, `EXPIRED`, `DELETING`, `DELETED`. Failed conversions keep the original and can be retried.
- **Custom player:** buffered progress, speed, volume, PiP, fullscreen, keyboard shortcuts, double-tap seek (touch), auto-hide controls, buffering/error states, automatic recovery with a fresh playback URL.
- **Viewer limit** with heartbeat + timeout so closed tabs release their slot; the viewer slot is claimed atomically in MongoDB.
- **Expiry safety:** every request checks `now < expiresAt` before returning anything; cleanup is a separate retried background job.
- **Direct downloads** from Cloudinary's CDN (nothing large flows through your server).

## Quick start

```bash
npm run install:all
cp .env.example server/.env      # fill in values
npm run seed                     # creates the owner account (email + password from SEED_OWNER_*)
npm run dev:server               # API on :4000
npm run dev:client               # UI on :5173 (proxies /api)
npm test                         # unit tests for the business rules
```

Production: `npm run build && npm start` (the server serves `client/dist`).

## Environment variables

See [`.env.example`](.env.example). Required: `MONGODB_URI`, `JWT_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. The server refuses to start if any is missing. No secrets are committed (`.env` is git-ignored).

## Deploying to Render

1. Push to GitHub, create a Web Service from the repo (or use `render.yaml`).
2. Build: `npm run build` · Start: `npm start` · Health check: `/api/health`.
3. Set the environment variables above, then run `npm run seed` once (Render Shell, or locally with the production `MONGODB_URI`) (`PUBLIC_BASE_URL` = your Render URL).
4. **Free tier sleeps when idle.** Expiry is enforced on every request regardless, but physical deletion needs the server awake. Point a free pinger (cron-job.org / UptimeRobot) at `POST /api/cron/tick` with header `x-cron-secret: <CRON_SECRET>` every 5–10 minutes.

## API overview

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login` (email + password), `GET /api/auth/me` |
| Upload (owner) | `POST /api/uploads/init`, `/:id/sign`, `/:id/complete`, `/:id/abort` |
| Videos (owner) | `GET /api/videos`, `DELETE /api/videos/:id`, `POST /api/videos/:id/retry` |
| Watch (public) | `GET /api/watch/:shareId`, `POST …/session`, `POST …/heartbeat`, `POST …/leave`, `GET …/playback`, `GET …/download` |

## Known limitations (be honest with yourself before shipping)

- **Not exercised against live services.** The unit tests, API smoke tests and production build pass, but I had no MongoDB or Cloudinary credentials, so the upload → convert → stream → delete flow has not been run end to end. Do one real upload before relying on it.
- **Cloudinary limits:** free-plan file-size and video limits are far below 20 GB. Set `MAX_UPLOAD_BYTES` to what your plan actually allows. Cloudinary's chunk-resume behaviour relies on reusing the same `X-Unique-Upload-Id`; if Cloudinary has discarded a partial upload, the server-side completion check fails with a clear message and you re-upload.
- **Original is kept after conversion.** The spec asks to delete the original once the output is verified, but Cloudinary renditions are derived from the source asset, so deleting it would break playback. The whole asset is deleted at expiry/delete.
- **Playback/download URLs are signed but not time-limited.** They are only handed out after the expiry and viewer-session checks, and deleting the asset (with CDN invalidation) kills them. Per-URL expiry would need Cloudinary token-based auth (a paid feature).
- **JavaScript can't run while the OS suspends the page.** The uploader never claims otherwise: it detects the interruption, keeps the saved offset, and continues on return.
- **Screen off / tab switch:** a tab switch keeps uploading. A phone lock or laptop sleep can pause JavaScript, so ReelVault asks the browser to keep the screen awake during uploads (Wake Lock, not supported everywhere) and, if it still gets suspended, resumes from the last confirmed chunk (the chunk in flight, up to 10 MB, is re-sent). Not yet tested on real devices.
- **Refresh recovery needs the same file re-selected** (browsers don't let a page reopen a file by itself).
- A viewer who already knows the link can still open it in two tabs; each tab counts as a viewer.

## Project layout

```
server/src  config · models · services (storage, rules, viewers, videos, workers) · routes · middleware
client/src  pages · components (VideoPlayer, toasts, modal…) · lib (api, uploader, format) · styles
```
