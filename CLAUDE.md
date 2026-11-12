# Energy Central Partner Portal

Client-facing portal replacing the per-client "Customer Report" Google Sheets. Clients log in and see their own
campaign results and leads; the EC team uses `/admin` to review numbers before clients see them.

## Stack
- Next.js 16 (App Router, `src/`), Tailwind v4, deployed on Vercel. **Read `AGENTS.md` first: this Next version differs from older docs** (`proxy.ts` not middleware, async `params`, Cache Components on; root layout sets `instant = false` because every page reads the session).
- Supabase project "EC Client Portals": Postgres + Auth (email/password). Schema in `supabase/migrations`, seeds in `supabase/seed` (already applied).
- Data pulls are TypeScript scripts in `scripts/`, run with the service role key. They log every run to `sync_runs`.

## Rules that must hold
- **Row-level security is the access control.** Clients read only their own `client_id` rows, and only `metrics` with `status = 'approved'`. Never query with the service role key from app code; only `scripts/` uses it.
- **No public sign-up.** Logins are created by an admin (Supabase invite), then linked by setting `profiles.client_id`.
- **Numbers reach clients only after approval** in `/admin/approvals`. Pull jobs insert `pending`, or `flagged` with a `flag_reason` when a value is far outside that client's usual range.
- **Notion is the source of truth for what was sold and scheduled.** `[Master] Energy Central Campaigns` → `campaigns`; `[Master] Energy Central Campaign Inventory` → `deliverables` (one row per EC-XXXX tag). A client is "live" if it has a campaign not marked Done. The sync creates a client for every Partner that has a campaign and sets `is_active` from Notion on each run; non-client partners (house ads, DTECH, RE+) are in `SKIP_PARTNERS` and spelling variants in `PARTNER_ALIASES` in `scripts/sync-notion.ts`.
- **Names and links.** The portal shows the Notion `Deliverable` value verbatim (`deliverable_label`), so clients read exactly what was sold. Newsletter ads link to that day's issue through `newsletter_issues` (publication + date); everything else links through `deliverables.live_url`. Pulls should fill both.
- **Website ad impressions are out of scope** until an ad server exists (the current "home page views" figure doesn't reconcile). Do not surface `website_ad` impressions to clients.
- Brand: navy #225591, yellow #FFE02D, orange #FD713B, blue #3F8EF5; fonts Family (display) and Switzer (body). Say "daily newsletter", never "briefing"; sponsored posts are "Partner Content".

## Metric definitions and timing (from Isuri's "EC SOP Production" doc)
| Deliverable | Numbers | Source | Pull when |
|---|---|---|---|
| Newsletter ad | impressions = Total Opens of that day's EC Daily; clicks | beehiiv; short.io | 14 days after run date |
| Email blast | sent = Delivered, opens = total opens, clicks = total raw clicks (SOP says unique; the sheets and the portal use totals, see below) | beehiiv (EC Marketing pub) | 7 days after send |
| Webinar / PowerSession | registrants, attendees; live leads | Zoom Events | day after; on-demand leads flow in continuously from Tally |
| Podcast | plays (Flightcast, no API: manual), short_form_views (YouTube + LinkedIn), impressions, clicks | mixed | 30 days after publish |
| Content | views, likes, comments | Bettermode (beehiiv after migration) | 14 days |

Short.io links do not follow one naming pattern (`Semtech.10.8.news`, `Semtec.9.10.news`, `Semtechnews2.22`), so never derive a link from client+date: store it on the deliverable (`short_link`). Count clicks only inside a fixed window (run date + 14 days); late and bot clicks inflate totals.

## Where links and client-facing names come from (checked on Semtech, Nov 2026)
Notion inventory rows carry no link and usually no title (`Notes` is internal shorthand like "Campaign #2"), so pulls must supply both: `deliverables.live_url` and `deliverables.display_title`. The Notion sync never writes those two columns.
| Deliverable | Link | Name | How a pull finds it |
|---|---|---|---|
| Newsletter ad | that day's issue, `news.energycentral.com/p/<slug>` via `newsletter_issues` | issue headline | beehiiv "Energy Central" pub, tag `daily-newsletter`, by send date |
| Email blast / marketing email | none: Energy Central Marketing posts are `platform: email`, so their `/p/` URL does not load | `subject_line` of the beehiiv post | EC Marketing pub. Titles and tags are inconsistent (7 of the last 100 posts tagged `paid-email`, 43 untagged; "Semtech Paid 11/10", "Semtech - Paid Email Blast - 09.06.26"). Match on client name in title + send date within 2 days of the Notion date, and flag anything unmatched rather than guessing |
| Webinar / PowerSession | the recording in the Zoom Events hub (Chloe, Nov 11 2026: link here, not the energycentral.com event page), `events.zoom.us/e/channel/nEP4pfyuQeu3tzRFrOoksw/recording/<id>` | the Zoom title, as is ("Semtech Presents: ...") | Zoom Events hub on-demand list (organizer view ends `/vod`); titles start "<Client> Presents:", match on that + event date. Registrants, attendees and leads come from the same hub |
| Content | the Bettermode post URL | post headline | Bettermode |

**Email numbers: match the sheets (Chloe, Nov 11 2026).** Clients have already been shown the sheet figures, so the portal and `pull-beehiiv.ts` report the same ones: sent = beehiiv `total_delivered`, opens = `total_opened` (total, not unique), clicks = `total_email_clicked_raw` (total raw, not unique or verified). This overrides the SOP row above, which says unique. Store unique and verified figures too if cheap, back-end only.

**Paid email blasts need a web version (process change, not yet in place).** This applies to paid emails only (Notion "Email Blast"), not marketing emails (the promo sends for a client's webinar or white paper), which stay email-only and unlinked. Already-sent posts can be switched to web after the fact. Paid emails should be published as "email and web" with "hide from feed" on, so each has an unlisted link at `energycentralmarketing.beehiiv.com/p/<slug>` that the portal can use as `live_url`. Because the web page shows the post title, the internal title ("Semtech Paid 11/10") has to stop being client-visible: either title the post with the subject line or turn off "display title on web". Put the EC number (EC-3167) in the slug or a tag so the pull can match exactly.

## Benchmarks
Clients see each number against the Energy Central average ("+48% vs average", plus an average row at the top of each table). Averages live in the `benchmarks` table (deliverable_type, metric, value; rates `ctr` and `attendance` are fractions), seeded from the media kit "Benchmark Results" slide (Oct 2026). Website ad and community takeover impressions are left out on purpose (same reason as above). Later: recompute from approved portal data once enough clients are in.

## Leads
- **Lead rows are personal data: never commit them to the repo** (no `data/*.json` for leads, unlike metrics). Semtech's history was loaded straight from the lead sheets into Supabase through the SQL editor.
- `leads.source` + `leads.attended` drive the client-facing "how they came in": `webinar_live` + attended → "Attended live", `webinar_live` + not attended → "Registered", `webinar_on_demand` → "Watched on demand". `leads.origin` records the system (zoom, tally, legacy_sheet, manual).
- Leads have no approval step: clients see them as soon as they land.

## Task list
1. [done] Schema, RLS, client seed (65 clients, 34 live).
2. [done] Login, `/admin` (clients, client detail, approvals, data-pull log), `/portal` client view.
3. [done] `scripts/sync-notion.ts`, run from the "Sync Notion campaigns" GitHub Action (manual trigger; secrets `NOTION_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`).
4. `scripts/pull-shortio.ts`: for deliverables past `reporting_due_date` with a `short_link`, fetch clicks for the window, insert `metrics`.
5. `scripts/pull-beehiiv.ts`: newsletter ad impressions and email blast stats, matched by date / post id.
6. Flagging: compare each new value to the client's median for that metric and deliverable type; flag beyond 3x.
7. Tally webhook → `leads` (consent checkbox → `consent`, `origin = 'tally'`); Zoom Events registrants/attendees → `metrics` + `leads` (`origin = 'zoom'`, `attended` true/false). Every new lead should land without anyone touching a sheet.
8. Admin: invite a client user and link to a client. [done] Leads table in the client view: filter by how they came in, search, CSV download (`LeadsTable.tsx`).
8b. CRM push (Chloe, Nov 11 2026): each client can have new leads added to their own CRM automatically, tagged with the Energy Central source (event title, how they came in). Plan: one connection per client (HubSpot first, plus a generic webhook for Salesforce/Marketo/Zapier), run from `scripts/` after each lead pull, stamp `leads.crm_pushed_at`. Not started; needs to know which CRMs clients use.
9. [Semtech done as pilot; `scripts/import-legacy.ts` + `data/legacy/*.json`, run from the "Import legacy reports" Action] History import from the legacy reports in `clients.customer_report_sheet_url`. They are a mix of Google Sheets and .xlsx with the same 8 tabs; insert as `source = 'legacy_sheet'`, `status = 'pending'`.
10. Schedule the pulls nightly (Vercel Cron or Supabase scheduled functions).

## Commands
`npm run dev` · `npm run build` · `npm run lint` · `npm run sync:notion`
Env: copy `.env.example` to `.env.local`.
