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
- **Website ad impressions are out of scope** until an ad server exists (the current "home page views" figure doesn't reconcile). Do not surface `website_ad` impressions to clients.
- Brand: navy #225591, yellow #FFE02D, orange #FD713B, blue #3F8EF5; fonts Family (display) and Switzer (body). Say "daily newsletter", never "briefing"; sponsored posts are "Partner Content".

## Metric definitions and timing (from Isuri's "EC SOP Production" doc)
| Deliverable | Numbers | Source | Pull when |
|---|---|---|---|
| Newsletter ad | impressions = Total Opens of that day's EC Daily; clicks | beehiiv; short.io | 14 days after run date |
| Email blast | sent = Delivered, opens = Unique Opens, clicks = Unique Clicks | beehiiv (EC Marketing pub) | 7 days after send |
| Webinar / PowerSession | registrants, attendees; live leads | Zoom Events | day after; on-demand leads flow in continuously from Tally |
| Podcast | plays (Flightcast, no API: manual), short_form_views (YouTube + LinkedIn), impressions, clicks | mixed | 30 days after publish |
| Content | views, likes, comments | Bettermode (beehiiv after migration) | 14 days |

Short.io links do not follow one naming pattern (`Semtech.10.8.news`, `Semtec.9.10.news`, `Semtechnews2.22`), so never derive a link from client+date: store it on the deliverable (`short_link`). Count clicks only inside a fixed window (run date + 14 days); late and bot clicks inflate totals.

## Task list
1. [done] Schema, RLS, client seed (65 clients, 34 live).
2. [done] Login, `/admin` (clients, client detail, approvals, data-pull log), `/portal` client view.
3. [done] `scripts/sync-notion.ts`, run from the "Sync Notion campaigns" GitHub Action (manual trigger; secrets `NOTION_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`).
4. `scripts/pull-shortio.ts`: for deliverables past `reporting_due_date` with a `short_link`, fetch clicks for the window, insert `metrics`.
5. `scripts/pull-beehiiv.ts`: newsletter ad impressions and email blast stats, matched by date / post id.
6. Flagging: compare each new value to the client's median for that metric and deliverable type; flag beyond 3x.
7. Tally webhook → `leads` (consent checkbox → `consent`); Zoom Events registrants/attendees → `metrics` + `leads`.
8. Admin: invite a client user and link to a client; leads table with CSV export in `/portal`.
9. History import from the legacy reports in `clients.customer_report_sheet_url`. They are a mix of Google Sheets and .xlsx with the same 8 tabs; insert as `source = 'legacy_sheet'`, `status = 'pending'`.
10. Schedule the pulls nightly (Vercel Cron or Supabase scheduled functions).

## Commands
`npm run dev` · `npm run build` · `npm run lint` · `npm run sync:notion`
Env: copy `.env.example` to `.env.local`.
