# SEAM

From client feedback to what ships. See `DESIGN-NOTES.md` for how the design handoff was implemented and what is not built yet.

Clients record a video of a bug or UAT issue, send a request or ask a question. Each report is a row in a tracker your team works through until it is resolved and verified by the client. Selected work is published on a client roadmap. Clients and admins both get emails as things change.

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
6. **Redeploy** so the new variables apply. Open the site, choose **Forgot your password?**, enter your admin email, and set a password from the link we email you. After that you sign in with your email and password. (Email has to be working for this first step, see step 4.)
7. In the app: **Projects and people** > add a project > invite their lead. They get an email with a link to set their own password. If an invitation email did not arrive, use **Send set-password link** next to their name.

Optional: set `MAX_VIDEO_MB` (default 500).

## What clients and admins can do

- **Clients** use one page, **My items**. They send a Bug, UAT finding, Feature request or Question (video optional, no time limit on a recording). Bugs and UAT findings go to the fix list; features and questions land on their roadmap. They switch between a list and the roadmap stages, filter by type and status, see how many items are pending, approve anything as done, confirm or reject a fix, and drag their roadmap cards between stages. A client can be invited into several projects and switches between them.
- **Admins** triage new reports in the **Inbox**, work everything in the **Tracker**, reply to clients and keep private internal notes in the report drawer, and build the **Roadmap**: create items, link the reports they cover, and publish them. Publishing is always explicit. An item moving to Done does not resolve its reports. Admins see when a client moved a card.

## Accounts and passwords

Sign-in is email and password. There is no magic-link sign-in.

- **First password:** an invitation (or **Forgot your password?** for an address that has an account) emails a one-time link to a page where the person chooses a password. The link works once, lasts 7 days for an invitation and 1 hour for a reset, and is only used up when the form is submitted, so email scanners that open it cannot spoil it.
- **Passwords** are stored only as salted scrypt hashes (built into Node). The rules are at least 10 characters, not a common password, and not containing the email name.
- **Protection:** wrong attempts are counted per address and per network and block sign-in for a few minutes. The same message is shown for a wrong password and an unknown address, and the response takes the same time. Resetting or changing a password signs out every other device and sends a notice email.
- **Account page:** change your own password. Admins can send anyone a set-password or reset link from **Projects and people**.

## How uploads work on Vercel

Videos never pass through a function (which caps request size). The browser asks the API for a short-lived upload token, uploads directly to Blob, then tells the API it is done. The API checks the blob exists, is a video, and is the right size before accepting it. Playback sends the browser to a signed link that expires in 5 minutes, so videos stay private and seeking works.

## Run it locally

```bash
npm install
cp .env.example .env      # then set ADMIN_EMAILS to your email
npm run dev               # web on :5173, API on :8787
```

No accounts needed locally. Run `npm run seed` for demo data and demo passwords (it prints them; `seam-demo-1234` unless you set `SEED_PASSWORD`). Or choose **Forgot your password?** on the sign-in page: in local development the page shows the link directly, so you never need a mailbox. With `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` empty, an embedded Postgres (PGlite, stored in `./data/pgdata`) and local-disk video storage are used. It is the same SQL as production. Emails print in the terminal.

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
