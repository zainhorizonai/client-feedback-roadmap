# SEAM design implementation notes

The UI follows `SEAM-DESIGN.md` from the design handoff. The tokens are in `src/styles/tokens.css` (unchanged from the
handoff) and are mapped onto Tailwind in `src/index.css`. The brand SVGs are in `public/brand/`.

## What is built

- **Brand:** SEAM wordmark and mark, favicon, stepped seam divider on sign-in, SEAM email header. Instrument Sans and
  IBM Plex Mono are bundled (`@fontsource`), so no third-party font request is made.
- **Shells:** admin sidebar (224px) with the project selector above Inbox, Tracker, Roadmap. Below 1024px the same links
  sit in a compact top bar. Clients get a header with the project name, My reports, Roadmap and New report.
- **Shared components:** Button, StatusBadge/SeverityBadge, Field, Drawer (labelled dialog, focus trap, Escape, focus
  returned to the opener, full screen on phones), VideoEvidence (native controls, never autoplays), EditableCell,
  RoadmapBoard, EmptyState, Skeleton, History and Conversation.
- **Client:** sign in (loading, check-your-email, resend with a wait, expired link, return to the requested page),
  My reports (search and filters, empty states), New report (type choice, record or upload, optional video,
  required title with a local error), Report received, report detail with Confirm fixed and Still broken, roadmap.
- **Admin:** Inbox (triage queue, sort by date or severity, triage actions), Tracker (sortable native table, sticky
  header and ID, column settings, filter chips, saved views, Export current view, inline edit), one shared report drawer
  (video first, shared replies and internal notes clearly separate, resolution evidence, history) and Roadmap
  (four columns, drag plus an equivalent menu, item editor, linked reports, explicit publish, client preview).
- **Product rules:** new status "Needs client input"; "Verified by client" and "Closed by admin" recorded as history
  outcomes; each status change stored with old value, new value, actor and time; reopening clears the resolved date and
  keeps earlier closures. Roadmap items are separate records linked to reports. Moving an item to Done never resolves a
  report. Clients see only published items from their own project, with no reporter details, notes or report links.
- **Notifications:** subjects and wording follow section 7. Triaging sends no default email. Internal notes never email.
  Retest decisions email the admins.
- **Data:** roadmap stages kept on reports by the previous version are converted into published roadmap items
  automatically the first time the new version starts.

## Where this goes beyond or against the SEAM spec (on request)

These were asked for directly, so they replace the spec's version:

- **One client view.** Clients have a single page, **My items**, instead of separate My reports and Roadmap pages. It has a
  List and a Roadmap stages view, a Bugs and UAT / Roadmap filter, a status filter (fix statuses and roadmap stages),
  search, and Pending / Waiting for you / Done counts.
- **Features and questions go to the roadmap automatically** as published cards in Under review, linked to the report.
  Bugs and UAT findings stay in the fix list. The roadmap still also holds anything the team adds and publishes.
- **Clients can drag their own roadmap cards between stages** (or use the menu on the card). The spec said clients get no
  controls for changing plans. Every move is recorded with who and when, the team is emailed, and admins see "Moved by the
  client" on the card. Bugs are placed on the board by their status and cannot be dragged.
- **Clients can approve anything as done**, not only a fix waiting to be verified. A fix in Ready to verify is recorded as
  "Verified by client". Anything else is "Closed by client". Approving a feature request also finishes its roadmap card when
  the card stands for that one request.
- **A client can belong to several projects** with one sign-in and a project switcher that shows pending work per project.
  Inviting an existing client to another project adds them to it.
- **Roadmap cards carry the ids of the client's own linked reports** so a card can lead to its conversation. These are
  reports in the client's own projects that they can already open.

- **Email and password sign-in** replaces the spec's emailed sign-in link. The sign-in screen has Email, Password with a Show
  control, and Forgot your password. First-time setup and resets use a one-time emailed link to a set-password page.
- **Clients can reopen** anything that is done (it returns to the team's inbox as New, and the earlier closure stays in the
  history), and **edit their own ticket's title, description and link** after sending it. Notes go in the conversation,
  which the interface now calls Notes and replies.
- **Profile menu** top right for everyone signed in: initials, name, email, role, the projects they can switch between,
  Account and Sign out.

- **Webcam recording, Loom-style.** The record control offers Screen, Screen and camera (the screen with the person's face
  in a round bubble in a chosen corner) and Camera, with a countdown and a live self-view. The camera mode is also how phones
  record, since they cannot share a screen. Screen and camera needs Chrome or Edge on a computer; other browsers are
  offered Screen and Camera and told why. If the microphone or camera is blocked the person is told, and upload is always
  available.

- **Admin people and project management.** Projects can be renamed in place (names must be unique, and the new name shows everywhere at once, including on clients' screens when they return to the tab). Per person: rename, resend the invitation (or send a reset link once they have
  accepted), remove from a project. Removal is soft, so reports keep their author's name, and the person can be invited
  again later with a fresh password. A project can be deleted after typing its name; that removes its reports, history,
  roadmap and stored videos. The project selector is a multi-select with chips, shared by the Inbox, Tracker and Roadmap.

## Design defaults used (from the spec's own list)

Breakpoints 768px and 1024px, default tracker columns, export scope, 224px sidebar and 480px drawer. Lower-frequency
tracker columns (Reporter, Description, Page, Resolution, Resolved, Project) start hidden below 1700px and can be
switched on under Columns. A "project" in the interface is a client organisation in the data.

## Not built yet

| Spec item | Status |
| --- | --- |
| Resolution video **upload** with its own progress | The drawer takes a **link** to the resolution video. Uploading a second video per report is not built. |
| Video poster image | Not generated. The native player shows the first frame. |
| Follow updates and roadmap update emails | Not built, so there is no Follow button and no roadmap email. |
| Team assignment, round sign-off | Not built (the spec says enable when supported). |
| Reminders for Needs client input | The status emails once. Timed reminders are not built. |
| Conflict handling on inline edit | Last save wins. A failed save keeps the draft and offers Retry. |
| Excel export | CSV only. |
| Full view-as-client | The roadmap has a client preview. Other client pages are not previewable by an admin. |
| Shared saved views | Saved views and column choices are stored per browser. |
| Console and network capture, session replay | Out of scope in the handoff. |

The handoff notes that it does not establish that the name SEAM is available. Check that before using it publicly.

## Phase 0: friction fixes

- A reply can move the status in the same step ("Then set status to"). A question defaults to Needs client input, so the client sees it in Waiting for you.
- The Inbox shows how many new reports are waiting, and its rows open the ticket on click.
- Clients no longer pick a severity. They tick "This is stopping us from working" (High); the team sets the real severity when triaging.
- Clients see plain status words: Received, Reviewing, In progress, Needs you, Ready to verify, Done. The team keeps the finer statuses.
- After sending, the new item opens over the list.
- Items are numbered per project (ACME-1, ACME-2). Existing items keep their old ids (BUG-0001 and so on).

## Phase 1: faster triage and follow-up

- **Owners:** every report can be assigned to someone on the team (in the ticket, in bulk, or automatically when you press Start triage). The new owner gets an email. A "Mine" tile and an owner filter in the Tracker act as a personal queue (`/admin/tracker?mine=1`). Clients never see owners.
- **Bulk changes:** tick rows in the Tracker, then set status, severity and owner for all of them at once. Clients are emailed about status changes exactly as if each had been changed one by one.
- **Waiting time:** the Inbox flags how long something has sat, and the Tracker has an optional Waiting column.
- **Reminders:** a client who has not answered for three days (a question, or a fix to check) gets a reminder, at most three times. This runs in the nightly cleanup job.
- **Email preference:** each person chooses "as they happen" or "one summary a day" on their Account page. Sign-in and password emails always go straight away.
- **Clients:** an unfinished report (text and video) survives a refresh or closed tab; similar open items are suggested before sending; a dropped connection during upload is retried three times before it asks the person to try again.
- **Not built:** truly resumable uploads. A failed upload still restarts from the beginning, though the recording is kept so nobody has to record again.

## Phase 2: help the developer

- **Environment on every report:** browser, system, device, window size, language and time zone are sent with each report and shown to the team under "Where it happened". Clients never see this section.
- **Page snippet (`public/seam-widget.js`):** one line on the site clients test adds a "Report a problem" button. It keeps a rolling record of console messages, script errors and failed requests in memory, and hands it to SEAM only when the person reports something (they can untick it). Web addresses are recorded without the query string or fragment. Copy the line from **Projects and people**.
  - Limits: it only sees pages that have the line installed, and only what happens after the page loads. It cannot read another site's console, and a browser that blocks pop-ups falls back to a plain report.
  - How it is kept safe: the snippet only talks to SEAM's own address, SEAM only accepts the hand-over from the window that opened it, and the server re-shapes and clips everything. It is always shown as plain text.
- **Notes pinned to the video:** "Add video time" puts the current moment (for example `[1:23]`) in a note, and that moment becomes a button that jumps the video there, for both clients and the team.
- **Not built:** transcripts, an AI summary and suggested titles. They need a speech-to-text service and an AI key, which are not set up. Integrations (Linear, Jira, GitHub, Slack, Teams) were left out on purpose.

## Design polish

- **Motion:** dialogs fade and rise into place (a sheet from the bottom on phones), menus and toasts glide in, buttons give press feedback. All of it is short, and all of it stops when someone has reduced motion turned on. Closing is still instant.
- **Depth and shape:** three shadow levels (`--seam-shadow-1/2/3`) and softer corners (`--seam-radius-control/card/modal`), all in `tokens.css`.
- **Touch:** on any touch screen (`pointer: coarse`), including tablets, every control is at least 44px, whatever the window width. With a mouse, controls stay compact.
- **Brand line:** the logo's stepped line appears in empty states and draws itself as an upload progresses.
- **Not done:** dark mode, and a closing animation for dialogs.

## Genesis design system

SEAM now follows the Genesis design system (DM Sans body, General Sans headings, JetBrains Mono for IDs, indigo for anything interactive). All values live in `src/styles/tokens.css`. The SEAM name and logo are unchanged.

- **Layout:** one sticky 56px top bar for both roles (logo, project switcher, modules, main action, avatar menu) with a hamburger menu below 1024px. The left sidebar is gone. Content is capped at 1280px.
- **Where it departs from the spec, on purpose:**
  - Field and menu borders are one step darker than the spec's `#E8E8EC` (`#CFCFD6`), and keyboard focus is a 2px indigo outline (text fields use the spec's soft ring), because the spec values are too faint to see.
  - Fields use 16px text on touch screens, so phones do not zoom in when one is focused.
  - Status chips use soft fills with darker text (not the raw success, warning and error colours) so they stay readable.
  - Headings are bold (700) and UI text is regular and medium, which is three weights, not two.
- **Not included:** dark mode, the global search (⌘K) and the interactive dot grid.
- **Font loading:** General Sans loads from Fontshare (`index.html`), the only third-party request. Until it arrives, headings use bold DM Sans.
