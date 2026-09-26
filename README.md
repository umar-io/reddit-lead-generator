# Lead Radar

Config-driven, read-only **Reddit + Hacker News lead discovery** with AI qualification and pluggable outputs.

Point it at any niche: edit `lead-radar.config.json` (subreddits, keywords, your business profile, outputs), add one API key, and it scans, scores 0–100 with Groq, and delivers a digest to **Slack, Discord, a generic webhook, or a JSON file** for manual human review.

**It never posts, comments, DMs, votes, or auto-contacts anyone.** Outbound actions are output channels only.

## How it works

```
Discovery → Dedupe → AI Qualification → (if promising) Comment analysis + Enrichment → Outputs
```

1. **Discovery** (`src/collectors/`) — sources + keywords from config:
   - `redditRss.ts` — login-free, always-on. Rotating subset (3 subs/day) via official `r/{sub}/new/.rss` feeds.
   - `hackernews.ts` — HN Algolia Search API + Items API for comments. No key needed.
   - `reddit.ts` — OAuth search (`oauth.reddit.com`) + `/new` scan when credentials exist. GET-only, polite User-Agent, 1.2s+ gap, backoff on 429/5xx.
2. **Dedupe** (`src/storage/leads.ts`) — `seen-posts.json` locally (`data/seen-posts.json`), in-memory on Vercel (`VERCEL=1`). `LeadStore` interface is Postgres-ready.
3. **AI Qualification** (`src/ai/qualifier.ts`) — Groq (`openai/gpt-oss-20b` default) scores 0–100. The system prompt is built from **your** `business` config (name, description, services), with strict anti-hallucination rules + validation:
   - `🔥 85–100 Strong` / `🟠 70–84 Worth investigating` / `🟡 55–69 Research only` / `🔴 <55 Ignore`
   - Evidence must be quoted/paraphrased from the post. Missing budget/business name → explicit `null` / "none", never invented.
4. **Comment analysis** (`src/analysis/comments.ts`) — summarizes discussion state; drafts a helpful, non-salesy comment **for manual review only**.
5. **Business enrichment** (`src/enrichment/business.ts`) — conservative, business-level only: website URL stated in-post + public homepage `<title>`/`<meta description>`. No personal data, no deanonymization, no login-walled pages. Confidence: `high/medium/low/none`.
6. **Outputs** (`src/notifications/`) — dispatcher (`index.ts`) fans out to every channel in `outputs.channels`, in `digest` or `per-lead` mode:
   - `slack.ts` → `SLACK_WEBHOOK_URL` | `discord.ts` → `DISCORD_WEBHOOK_URL`
   - `webhook.ts` → structured JSON POST to `GENERIC_WEBHOOK_URL` (Zapier/Make/Resend/your API)
   - `json.ts` → stdout, or appends to `JSON_OUTPUT_FILE` / `outputs.jsonFile`
   - Email: no built-in SMTP — use `webhook` → Zapier/Make/Resend, or `json` → your mailer.

## Tech stack

- TypeScript (ES2022, NodeNext) + `tsx`
- `groq-sdk` for AI qualification
- Vercel Serverless + Vercel Cron (`vercel.json` → `GET /api/cron/leads` daily at 09:00)
- File-backed JSON store (MVP), zero new runtime deps for the generalization

## Project structure

```
lead-radar.config.example.json  Copy to lead-radar.config.json, edit for your niche
.env.example                    All env vars (secrets + overrides)
api/cron/leads.ts               Vercel Cron — discovery → qualify → outputs fan-out
api/cron/lead.ts                Legacy route — qualifies a single manual/test post
src/pipeline.ts                 CLI + runLive() orchestration
src/appConfig.ts                Config loader (file + env overrides)
src/collectors/                 reddit.ts, redditRss.ts, hackernews.ts
src/ai/                         client.ts (Groq), qualifier.ts (config-built prompt)
src/analysis/                   comments.ts (conversation analysis)
src/enrichment/                 business.ts (public homepage meta only)
src/notifications/              index.ts (dispatcher), slack/discord/webhook/json
src/storage/                    leads.ts (FileLeadStore / MemoryLeadStore)
src/lib/                        slack.ts, groq.ts (legacy wrappers)
src/setup-reddit.ts             One-time Reddit OAuth helper
src/env.ts / types.ts           Secrets validation + shared types
data/seen-posts.json            Local dedupe store
```

## Setup

### 1. Prerequisites

- Node 18+, `pnpm` or `npm`
- Groq API key
- At least one output: Slack webhook, Discord webhook, generic webhook URL, or JSON output
- (Optional) Reddit script app for OAuth search — RSS + HN work without it

### 2. Install + configure

```bash
pnpm install
# or
npm install

npm run config:init   # copies lead-radar.config.example.json → lead-radar.config.json
cp .env.example .env.local  # then fill in secrets
```

### 3. Configure your niche (`lead-radar.config.json`)

```jsonc
{
  "appName": "Acme Leads",
  "business": {
    "name": "Acme Studio",
    "description": "a small webflow + automation studio",
    "services": ["landing pages", "automation", "CRM setup", "integrations"],
    "studioSizeNote": "could a SMALL studio realistically deliver it?"
  },
  "sources": {
    "subreddits": ["smallbusiness", "ecommerce", "ERP"],
    "keywords": ["looking for developer", "need automation", "CRM help"],
    "hnKeywords": ["looking for developer", "need software built"]
  },
  "outputs": { "mode": "digest", "channels": ["slack", "json"], "jsonFile": "./data/leads.json" }
}
```

Every file value can be overridden by env (comma-separated lists): `APP_NAME`, `SUBREDDITS`, `KEYWORDS`, `HN_KEYWORDS`, `OUTPUT_CHANNELS` (e.g. `slack,discord,webhook,json`), `OUTPUT_MODE` (`digest`|`per-lead`), `JSON_OUTPUT_FILE`, `LEAD_RADAR_CONFIG` (explicit config path).

### 4. Environment (`.env.local`, gitignored)

```bash
GROQ_API_KEY=...
SLACK_WEBHOOK_URL=...     # or DISCORD_WEBHOOK_URL / GENERIC_WEBHOOK_URL / OUTPUT_CHANNELS=json

# Tuning (optional)
# GROQ_MODEL=openai/gpt-oss-20b
# LEAD_SCORE_THRESHOLD=70
# MAX_POSTS_PER_RUN=12
# MAX_COMMENTS_PER_POST=8
# REDDIT_ENABLED=true

# Reddit OAuth (optional but recommended — anonymous Reddit is often 403)
# REDDIT_CLIENT_ID=... REDDIT_CLIENT_SECRET=... REDDIT_REFRESH_TOKEN=...
# Alternatives: REDDIT_BEARER_TOKEN=... or REDDIT_USERNAME/REDDIT_PASSWORD
# REDDIT_USER_AGENT=...
# REDDIT_REDIRECT_URI=http://localhost:8080

# Cron protection (Vercel)
# CRON_SECRET=...
# SEEN_STORE_PATH=./data/seen-posts.json
```

`src/env.ts` requires `GROQ_API_KEY` + at least one usable output at startup.

### 5. Reddit OAuth (optional, one-time)

```bash
# 1. Create a "script" app at https://www.reddit.com/prefs/apps
# 2. Fill REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in .env.local
npx tsx src/setup-reddit.ts
# 3. Open printed URL → Approve → copy REDDIT_REFRESH_TOKEN into .env.local
```

Scope requested is read-only: `read identity`.

## Usage

```bash
npm run test:lead      # sample post through AI stack → configured outputs
npm run pipeline:live  # full discovery → qualify → outputs
npm run pipeline:dry   # --live --dry-run --limit=5 (no output send)
npm run typecheck      # tsc --noEmit

# Manual variants
npx tsx src/pipeline.ts --live --dry-run --limit=5
npx tsx src/pipeline.ts --live --config=./my-niche.json
```

Behavior:

- Posts scoring `< 55` skip comment fetch/enrichment (`enrichOne` in `pipeline.ts`).
- Only leads `>= LEAD_SCORE_THRESHOLD` (default 70) are sent to outputs.
- Every seen post ID is marked regardless of outcome, so failures don't loop.
- `REDDIT_ENABLED=false` skips discovery entirely.

## Deployment (Vercel)

- `vercel.json` schedules `GET /api/cron/leads` daily (`0 9 * * *`).
- Set env vars in Vercel project settings + `CRON_SECRET` (checked as `Authorization: Bearer …`).
- Cron response: `{ ok, count, leads: [{ id, subreddit, title, url, score, buyingIntent }] }`.
- Storage on Vercel is ephemeral → `createLeadStore()` uses `MemoryLeadStore` when `VERCEL=1`. Add Postgres/Vercel KV for cross-run dedupe in production (see `src/storage/leads.ts` header).

## Safety & limits

- Read-only on Reddit/HN. No posting, commenting, voting, DMing.
- Suggested comments are drafts only — human must review/post manually.
- Enrichment never reports personal emails (gmail/yahoo/etc. filtered), private profiles, or inferred business names.
- Rate-limit conscious: rotating RSS subs (3/day, 4s gap), HN (≤4 queries, 1s gap), Reddit OAuth (rotating keywords, 1.2s gap, small caps).
- MVP caveats: no Postgres dedupe on Vercel, no tests, RSS keyword filter is headline+snippet only — AI is the real filter. Email has no native sender (use `webhook`).

## License

ISC
