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
