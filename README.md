# Feedback Portal

Clients record a video of a bug or UAT issue. Each video becomes a row in a spreadsheet-style tracker that you work through until it is resolved. Clients and admins both get emails as things change.

React + Vite frontend, Hono API, SQLite database, videos on local disk.

## Run it locally

```bash
npm install
cp .env.example .env      # then set ADMIN_EMAILS to your email
npm run dev               # web on :5173, API on :8787
```

Open http://localhost:5173 and sign in with your admin email. In local dev (`EMAIL_PROVIDER=console`) emails are printed in the terminal, and the sign-in page shows an "Open sign-in link" button so you do not need a mailbox.

Then, as admin: **Clients** > add a client > invite their lead. Sign in as that person in a private window to try the client side.

`npm run seed` adds two demo clients with a few reports (no videos) if you want sample data.

## Production

```bash
npm run build
NODE_ENV=production npm start     # one server: serves the site and the API
```

Set these in `.env` (see `.env.example`):

| Variable | Notes |
| --- | --- |
| `APP_URL` | Public https URL. Used in email links and for cross-origin checks. |
| `ADMIN_EMAILS` | Comma-separated. These people get admin access. |
| `EMAIL_PROVIDER` | `resend` to send real emails (needs `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain). `console` only logs. |
| `DATA_DIR` | Holds `portal.db` and `videos/`. **Back this folder up.** |
| `MAX_VIDEO_MB` | Upload limit, default 500. |

Run it behind HTTPS (Caddy, nginx or your host's proxy). Cookies are marked `Secure` when `APP_URL` is https. If your proxy buffers request bodies, raise its upload limit to match `MAX_VIDEO_MB`.

## Tests

```bash
npm test
```

Runs the API against a temporary database. Covers sign-in, one-time links, client isolation, hidden internal notes, video upload and seeking, validation and the status workflow.

## How it fits together

- `server/app.ts` all API routes. `server/auth.ts` magic links and sessions. `server/storage.ts` video files. `server/email.ts` email sending. `server/db.ts` schema.
- `src/lib/store.ts` and `src/lib/api.ts` are the frontend's only contact with the API.

Swappable parts: replace `server/storage.ts` to use S3 or R2, and `server/email.ts` to use another mail provider. Routes and screens do not change.

## Known limits

- Single server. Rate limiting and the upload lock are in memory. Add Redis if you run several instances.
- `node:sqlite` is built into Node 22 but still marked experimental. It works, and it prints a one-line warning on start.
- Browser-recorded WebM files usually have no duration or seek index, so scrubbing in the player can be limited. Re-encoding on upload (for example with ffmpeg) would fix it.
- No video deletion or retention job yet. Unfinished drafts older than a day are cleaned up automatically.
