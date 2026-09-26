# led-gen — Marz Lead Radar

Read-only B2B lead discovery pipeline for **Marz Studio**, a custom software development studio.

It scans Reddit + Hacker News for businesses asking for custom software / ERP / automation / integrations, scores them with AI (Groq), and sends a single daily digest to Slack for manual human review.

**It never posts, comments, DMs, votes, or auto-contacts anyone.** The only outbound action is a Slack webhook.

## How it works

```
Discovery → Dedupe → AI Qualification → (if promising) Comment analysis + Enrichment → Slack digest
```

1. **Discovery** (`src/collectors/`)
   - `redditRss.ts` — login-free, always-on. Scans rotating subset (3 subs/day) via official `r/{sub}/new/.rss` feeds.
   - `hackernews.ts` — HN Algolia Search API (`hn.algolia.com`) + Items API for comments. No key needed.
   - `reddit.ts` — OAuth search (`oauth.reddit.com`) + `/new` scan when credentials exist. GET-only, polite User-Agent, 1.2s+ gap, backoff on 429/5xx.
   - Target subs: `Shopify`, `ecommerce`, `InventoryManagement`, `3PL`, `smallbusiness`, `ERP`.
   - ~17 Reddit keywords (`looking for developer`, `custom ERP`, `inventory system`, …) + 8 HN keywords.
2. **Dedupe** (`src/storage/leads.ts`) — `seen-posts.json` locally (`data/seen-posts.json`), in-memory on Vercel (`VERCEL=1`). `LeadStore` interface is Postgres-ready.
3. **AI Qualification** (`src/ai/qualifier.ts`, `src/ai/client.ts`) — Groq (`openai/gpt-oss-20b` by default) scores 0–100 with strict anti-hallucination prompt + validation:
   - `🔥 85–100 Strong` / `🟠 70–84 Worth investigating` / `🟡 55–69 Research only` / `🔴 <55 Ignore`
   - Evidence must be quoted/paraphrased from the post. Missing budget/business name → explicit `null` / "none", never invented.
4. **Comment analysis** (`src/analysis/comments.ts`) — summarizes discussion state; drafts a helpful, non-salesy comment **for manual review only**.
5. **Business enrichment** (`src/enrichment/business.ts`) — conservative, business-level only: website URL stated in-post + public homepage `<title>`/`<meta description>`. No personal data, no deanonymization, no login-walled pages. Confidence: `high/medium/low/none`.
6. **Notification** (`src/notifications/slack.ts`, `src/lib/slack.ts`) — one digest message per run (`formatDigest`) or single-lead report (`formatLeadReport`) via `SLACK_WEBHOOK_URL`.

## Tech stack

- TypeScript (ES2022, NodeNext) + `tsx`
- `groq-sdk` for AI qualification
- Vercel Serverless + Vercel Cron (`vercel.json` → `GET /api/cron/leads` daily at 09:00)
- File-backed JSON store (MVP), Slack Incoming Webhook

## Project structure

```
api/cron/leads.ts      Vercel Cron — discovery → qualify → Slack digest
api/cron/lead.ts       Legacy route — qualifies a single manual/test post
src/pipeline.ts        CLI + runLive() / runTest() orchestration
src/collectors/        reddit.ts, redditRss.ts, hackernews.ts
src/ai/                client.ts (Groq), qualifier.ts
src/analysis/          comments.ts (conversation analysis)
src/enrichment/        business.ts (public homepage meta only)
src/notifications/     slack.ts (digest + lead report formatting)
src/storage/           leads.ts (FileLeadStore / MemoryLeadStore)
src/lib/               slack.ts (webhook sender), groq.ts (legacy wrapper)
src/setup-reddit.ts    One-time Reddit OAuth helper
src/env.ts / types.ts  Config + shared types
data/seen-posts.json   Local dedupe store
```

## Setup

### 1. Prerequisites

- Node 18+ , `pnpm` or `npm`
- Groq API key
- Slack Incoming Webhook URL
- (Optional) Reddit script app for OAuth search — without it, RSS + HN still work

### 2. Install

```bash
pnpm install
# or
npm install
```

### 3. Environment

Create `.env.local` (gitignored, takes priority over `.env`):

```bash
GROQ_API_KEY=...
SLACK_WEBHOOK_URL=https://hooks.slack.com/...

# Tuning (all optional, defaults shown)
GROQ_MODEL=openai/gpt-oss-20b
LEAD_SCORE_THRESHOLD=70
MAX_POSTS_PER_RUN=12
MAX_COMMENTS_PER_POST=8
REDDIT_ENABLED=true

# Reddit OAuth (optional but recommended — anonymous Reddit is often 403)
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_REFRESH_TOKEN=...   # from setup script below
# Alternatives: REDDIT_BEARER_TOKEN=... or REDDIT_USERNAME/REDDIT_PASSWORD
REDDIT_USER_AGENT=marz-lead-radar/1.0 (read-only lead research; contact: Marz Studio)
REDDIT_REDIRECT_URI=http://localhost:8080

# Cron protection (Vercel)
CRON_SECRET=...
# Local override for dedupe file
SEEN_STORE_PATH=./data/seen-posts.json
```

`src/env.ts` validates `GROQ_API_KEY` + `SLACK_WEBHOOK_URL` at startup.

### 4. Reddit OAuth (optional, one-time)

```bash
# 1. Create a "script" app at https://www.reddit.com/prefs/apps
# 2. Fill REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in .env.local
npx tsx src/setup-reddit.ts
# 3. Open printed URL → Approve → copy REDDIT_REFRESH_TOKEN into .env.local
```

Scope requested is read-only: `read identity`.

## Usage

```bash
npm run test:lead      # legacy test post through Groq → Slack
npm run pipeline:live  # full discovery → qualify → Slack digest
npm run pipeline:dry   # --live --dry-run --limit=5 (no Slack send)
npm run typecheck      # tsc --noEmit

# Manual variants
npx tsx src/pipeline.ts --live --dry-run --limit=5
npx tsx src/pipeline.ts --live
```

Behavior:

- Posts scoring `< 55` skip comment fetch/enrichment (`enrichOne` in `pipeline.ts`).
- Only leads `>= LEAD_SCORE_THRESHOLD` (default 70) trigger the Slack digest.
- Every seen post ID is marked regardless of outcome, so failures don't loop.
- `REDDIT_ENABLED=false` skips discovery entirely.

## Deployment (Vercel)

- `vercel.json` schedules `GET /api/cron/leads` daily (`0 9 * * *`).
- Set the same env vars in Vercel project settings + `CRON_SECRET` (checked as `Authorization: Bearer …`).
- Cron response: `{ ok, count, leads: [{ id, subreddit, title, url, score, buyingIntent }] }`.
- Storage on Vercel is ephemeral → `createLeadStore()` uses `MemoryLeadStore` when `VERCEL=1`. Add Postgres/Vercel KV for cross-run dedupe in production (see `src/storage/leads.ts` header).

## Safety & limits

- Read-only on Reddit/HN. No posting, commenting, voting, DMing.
- Suggested comments are drafts only — human must review/post manually.
- Enrichment never reports personal emails (gmail/yahoo/etc. filtered), private profiles, or inferred business names.
- Rate-limit conscious: rotating RSS subs (3/day, 4s gap), HN (≤4 queries, 1s gap), Reddit OAuth (rotating keywords, 1.2s gap, small caps).
- MVP caveats: no Postgres dedupe on Vercel, no tests, RSS keyword filter is headline+snippet only — AI is the real filter.

## License

ISC
