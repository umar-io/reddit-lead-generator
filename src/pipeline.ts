/**
 * lead-radar pipeline (general use — configure via lead-radar.config.json).
 *
 *   npm run test:lead          → sample post through AI stack → outputs
 *   npm run pipeline:live      → discovery → qualify → digest → outputs
 *   tsx src/pipeline.ts --live --dry-run --limit=5
 *   tsx src/pipeline.ts --live --config=./my-niche.json
 *
 * Read-only on Reddit/HN. Outbound actions are output channels only
 * (slack / discord / webhook / json) — never posts, comments, or DMs.
 */
import "./env.js";
import { config } from "./env.js";
import { appConfig } from "./appConfig.js";
import { discoverPosts, fetchPostComments } from "./collectors/reddit.js";
import { discoverViaRss } from "./collectors/redditRss.js";
import { discoverHn, fetchHnComments } from "./collectors/hackernews.js";
import { createLeadStore } from "./storage/leads.js";
import { qualifyPost, qualifyText } from "./ai/qualifier.js";
import { analyzeConversation } from "./analysis/comments.js";
import { enrichBusiness } from "./enrichment/business.js";
import { sendLeads, sendSingleLead } from "./notifications/index.js";
import type { EnrichedLead, RedditPost } from "./types.js";

const TEST_POST = `
I'm the owner of a growing distribution business with three warehouses.
We're currently using Excel to track inventory because our existing
software doesn't handle our workflow properly.

We're looking for a developer who can build us a custom ERP system
covering inventory, orders, purchasing and reporting.

We're willing to pay for the right solution.
`;

function args(): { live: boolean; dryRun: boolean; limit: number } {
  const a = process.argv.slice(2);
  // Note: --config= is consumed by appConfig at import time; nothing to do here.
  return {
    live: a.includes("--live"),
    dryRun: a.includes("--dry-run"),
    limit: Number.parseInt(
      a.find((x) => x.startsWith("--limit="))?.split("=")[1] ?? "",
      10
    ) || config.maxPostsPerRun,
  };
}

/** OAuth discovery only works with a usable Reddit account. */
function redditAuthAvailable(): boolean {
  const e = process.env;
  return Boolean(
    e.REDDIT_BEARER_TOKEN ||
      (e.REDDIT_CLIENT_ID &&
        e.REDDIT_CLIENT_SECRET &&
        (e.REDDIT_REFRESH_TOKEN || (e.REDDIT_USERNAME && e.REDDIT_PASSWORD)))
  );
}

async function discoverAll(limit: number): Promise<RedditPost[]> {
  const seen = new Map<string, RedditPost>();
  const take = (posts: RedditPost[]): void => {
    for (const p of posts) {
      if (!seen.has(p.id)) seen.set(p.id, p);
      if (seen.size >= limit) return;
    }
  };

  // Login-free sources first (always available).
  console.log("  …via Reddit RSS");
  take(await discoverViaRss(limit));
  if (seen.size < limit) {
    console.log("  …via Hacker News");
    take(await discoverHn(Math.min(10, limit)));
  }
  // Authenticated Reddit search only when credentials exist.
  if (seen.size < limit && redditAuthAvailable()) {
    console.log("  …via Reddit OAuth search");
    take(await discoverPosts({ maxTotal: limit }));
  } else if (!redditAuthAvailable()) {
    console.log("  …skipping Reddit OAuth (no credentials/account)");
  }
  return [...seen.values()];
}

async function enrichOne(post: RedditPost): Promise<EnrichedLead | null> {
  try {
    const qualification = await qualifyPost(post);
    if (qualification.score < 55) {
      console.log(`  ⏭️ [${post.id}] score ${qualification.score} — below research bar, skipping context`);
      return null;
    }
    // Promising → pull comments + enrichment (both best-effort).
    let conversation: EnrichedLead["conversation"] = null;
    try {
      const comments =
        post.source === "hackernews"
          ? await fetchHnComments(post, config.maxCommentsPerPost)
          : await fetchPostComments(post, config.maxCommentsPerPost);
      conversation = await analyzeConversation(post, comments);
    } catch (err) {
      console.warn(`  ⚠️ comment analysis failed [${post.id}]: ${(err as Error).message}`);
    }
    let enrichment: EnrichedLead["enrichment"] = null;
    try {
      enrichment = await enrichBusiness(post, qualification.businessName);
    } catch (err) {
      console.warn(`  ⚠️ enrichment failed [${post.id}]: ${(err as Error).message}`);
    }
    return { post, qualification, conversation, enrichment };
  } catch (err) {
    console.warn(`  ⚠️ qualification failed [${post.id}]: ${(err as Error).message}`);
    return null;
  }
}

/** Sample-post path — same AI → outputs flow, useful for smoke-testing config. */
async function runTest(dryRun: boolean): Promise<void> {
  console.log("🔎 Qualifying test lead (legacy test:lead path)...");
  const qualification = await qualifyText(TEST_POST);
  console.log(qualification);
  if (qualification.score < config.leadScoreThreshold) {
    console.log(`❌ Test lead score ${qualification.score} < ${config.leadScoreThreshold}, not sending.`);
    return;
  }
  const fakePost: RedditPost = {
    id: "test-lead",
    subreddit: "test",
    title: "Test lead — distribution business ERP",
    author: "test",
    selftext: TEST_POST,
    url: "https://www.reddit.com/r/test/",
    permalink: "/r/test/comments/test-lead/",
    createdUtc: Date.now() / 1000,
    numComments: 0,
    score: 0,
  };
  const lead: EnrichedLead = {
    post: fakePost,
    qualification,
    conversation: null,
    enrichment: null,
  };
  if (dryRun) {
    console.log("💡 dry-run: output send skipped");
    return;
  }
  await sendSingleLead(lead);
  console.log(`✅ Test lead sent via ${appConfig.outputs.channels.join(", ")}`);
}

/** Live path — Reddit → dedupe → qualify → digest. */
export async function runLive(opts: { dryRun: boolean; limit: number }): Promise<EnrichedLead[]> {
  if (!config.redditEnabled) {
    console.log("⏸️ REDDIT_ENABLED=false — skipping discovery");
    return [];
  }
  const store = createLeadStore();
  console.log("🔎 Discovering posts (Reddit RSS + Hacker News)...");
  const candidates = await discoverAll(opts.limit);
  console.log(`📥 ${candidates.length} candidates discovered`);
  const fresh = await store.filterUnseen(candidates);
  console.log(`✨ ${fresh.length} unseen (${candidates.length - fresh.length} already seen)`);

  const enriched: EnrichedLead[] = [];
  for (const post of fresh.slice(0, opts.limit)) {
    console.log(`🔬 [${post.id}] r/${post.subreddit}: ${post.title.slice(0, 90)}`);
    const lead = await enrichOne(post);
    // Mark seen regardless of outcome so failures don't loop forever.
    await store.markSeen(post.id, post.url);
    if (lead) enriched.push(lead);
  }

  const qualified = enriched.filter(
    (l) => l.qualification.score >= config.leadScoreThreshold
  );
  console.log(
    `✅ ${qualified.length}/${enriched.length} meet threshold (>=${config.leadScoreThreshold})`
  );

  if (opts.dryRun) {
    console.log("💡 dry-run: output send skipped");
    return qualified;
  }
  if (qualified.length > 0) {
    await sendLeads(qualified);
    console.log(`✅ Digest sent via ${appConfig.outputs.channels.join(", ")}`);
  } else {
    console.log("ℹ️ Nothing qualified — no output sent");
  }
  return qualified;
}

async function main(): Promise<void> {
  const { live, dryRun, limit } = args();
  if (live) {
    await runLive({ dryRun, limit });
  } else {
    await runTest(dryRun);
  }
}

main().catch((error) => {
  console.error("❌ Pipeline failed:", error);
  process.exit(1);
});
