# Feedback Portal

Clients record a video of a bug or UAT issue. Each video becomes a row in a spreadsheet-style tracker that you work through until it is resolved. Clients and admins both get emails as things change.

React + Vite frontend, Hono API on Vercel Functions, Postgres (Neon), videos in Vercel Blob (private).

## Deploy to Vercel

1. **Push this repo to GitHub** and import it in Vercel (**Add New > Project**). The framework is detected as Vite. `vercel.json` already sets the build, routing and the nightly cron.
2. **Add a database.** In the project: **Storage > Create > Neon (Postgres)**. This adds `DATABASE_URL` automatically. Tables are created on first request, there is nothing to run.
3. **Add file storage.** **Storage > Create > Blob**, and choose **Private** access. This adds `BLOB_READ_WRITE_TOKEN` automatically.
4. **Set email.** Pick one:
   - **Gmail (no domain needed):** turn on 2-Step Verification for the Google account, create an **App password** (Google Account > Security > App passwords), then set `EMAIL_PROVIDER` = `smtp`, `SMTP_USER` = the Gmail address, `SMTP_PASS` = the 16-character app password, and `EMAIL_FROM` = `Feedback Portal <that address>`. Gmail allows roughly 500 emails a day.
   - **Resend:** set `EMAIL_PROVIDER` = `resend`, `RESEND_API_KEY` and `EMAIL_FROM`. Without a verified domain, Resend only delivers to the address you signed up with.

   Without working email, sign-in links are only logged and nobody can sign in.
5. **Set the rest** (Project Settings > Environment Variables):
   - `ADMIN_EMAILS` = your email (comma-separate more). These people become admins the first time they sign in.
   - `CRON_SECRET` = any long random string. Enables the nightly cleanup of abandoned drafts and expired sign-in data.
   - `APP_URL` = optional. Defaults to the deployment URL. Set it to your custom domain once you add one.
6. **Redeploy** so the new variables apply, open the site, and sign in with your admin email.
7. In the app: **Clients** > add a client > invite their lead.

Optional: set `MAX_VIDEO_MB` (default 500).

## How uploads work on Vercel

Videos never pass through a function (which caps request size). The browser asks the API for a short-lived upload token, uploads directly to Blob, then tells the API it is done. The API checks the blob exists, is a video, and is the right size before accepting it. Playback sends the browser to a signed link that expires in 5 minutes, so videos stay private and seeking works.

## Run it locally

```bash
npm install
cp .env.example .env      # then set ADMIN_EMAILS to your email
npm run dev               # web on :5173, API on :8787
```

No accounts needed locally. With `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` empty, an embedded Postgres (PGlite, stored in `./data/pgdata`) and local-disk video storage are used. It is the same SQL as production. Emails print in the terminal, and the sign-in page shows an "Open sign-in link" button.

`npm run seed` adds two demo clients with a few reports (no videos).

## Tests

```bash
npm test
```

27 API tests against an in-memory Postgres: sign-in, one-time links, client isolation, hidden internal notes, upload and seeking, the Blob upload flow (with a fake Blob service), validation, the status workflow, rate limiting, concurrent report numbering and the cleanup job.

## Layout

- `api/[...path].ts` Vercel entry point. `server/app.ts` all routes. `server/auth.ts` sessions and magic links. `server/db.ts` Postgres (Neon or PGlite). `server/storage.ts` Blob and local-disk drivers. `server/email.ts` email.
- `src/lib/store.ts` and `src/lib/api.ts` are the frontend's only contact with the API.

## Known limits

- **Not yet tested on a live Vercel deployment.** Everything is tested locally, and the Blob and Neon calls follow their documented APIs, but the first deploy is the first real run against those services. If something fails, check the function logs in Vercel first.
- Browser-recorded WebM files usually have no duration or seek index, so scrubbing can be limited. Re-encoding on upload (for example with ffmpeg) would fix it.
- A video uploaded to Blob but never confirmed (browser closed mid-way) stays in storage. They are small in number but not cleaned up yet.
- No video deletion or retention policy yet.
- Email is sent during the request, which adds a few hundred milliseconds to actions that send mail.
