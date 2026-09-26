/**
 * Reddit RSS collector — no login required.
 *
 * Uses Reddit's official per-subreddit RSS feeds:
 *   https://www.reddit.com/r/{sub}/new/.rss
 * These are a documented public feature (same feed behind the "RSS"
 * buttons on the site), read-only, and reachable without an account.
 *
 * Rules: GET only, one request per sub per run, 1.5s gap, keyword
 * filtering happens client-side. No search endpoint here — RSS only
 * exposes new posts, so we scan headlines + snippets and let the AI
 * decide what's a real opportunity.
 */
import type { RedditPost } from "../types.js";
import { KEYWORDS, SUBREDDITS } from "./reddit.js";
import { appConfig } from "../appConfig.js";

const USER_AGENT = appConfig.sources.userAgent;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function pickTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return (m?.[1] ?? "").trim();
}

function pickLink(block: string): string {
  const m = block.match(/<link[^>]+href="([^"]+)"/i);
  return (m?.[1] ?? "").trim();
}

function pickAuthor(block: string): string {
  const m = block.match(/<author>\s*<name>([^<]*)<\/name>/i);
  const raw = (m?.[1] ?? "").trim();
  return raw.replace(/^\/u\//, "") || "[unknown]";
}

function idFromLink(link: string): string | null {
  const m = link.match(/\/comments\/([a-z0-9]+)/i);
  return m?.[1] ?? null;
}

async function fetchRss(sub: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`https://www.reddit.com/r/${sub}/new/.rss`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`RSS failed: ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scan /new via RSS across target subs, keep keyword-matching posts.
 * IDs are prefixed (rss_<id>) so they never collide with OAuth IDs.
 *
 * Rate-limit care: Reddit throttles RSS aggressively per IP, so each run
 * scans a ROTATING subset of 3 subs (daily cron still covers everything
 * across the week) with a 4s gap between requests.
 */
export async function discoverViaRss(maxTotal = 30): Promise<RedditPost[]> {
  const out: RedditPost[] = [];
  const keywords = KEYWORDS.map((k) => k.toLowerCase());
  // Rotate: day-of-year decides which 3 subs this run covers.
  const dayOffset =
    Math.floor(Date.now() / 86_400_000) % SUBREDDITS.length;
  const subs = [0, 1, 2].map(
    (i) => SUBREDDITS[(dayOffset + i) % SUBREDDITS.length]!
  );
  for (const sub of subs) {
    await new Promise((r) => setTimeout(r, 4000));
    let xml: string;
    try {
      xml = await fetchRss(sub);
    } catch (err) {
      console.warn(`⚠️ RSS failed r/${sub}: ${(err as Error).message}`);
      continue;
    }
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
    for (const entry of entries) {
      const title = decodeEntities(pickTag(entry, "title"));
      const link = pickLink(entry);
      const baseId = idFromLink(link);
      if (!title || !baseId) continue;
      const snippet = stripTags(pickTag(entry, "content")).slice(0, 1200);
      const hay = `${title}\n${snippet}`.toLowerCase();
      const kw = keywords.find((k) => hay.includes(k));
      if (!kw) continue;
      const updated = Date.parse(pickTag(entry, "updated")) / 1000 || 0;
      out.push({
        id: `rss_${baseId}`,
        source: "reddit",
        subreddit: sub,
        title,
        author: pickAuthor(entry),
        selftext: snippet,
        url: link.startsWith("http") ? link : `https://www.reddit.com${link}`,
        permalink: link.replace("https://www.reddit.com", ""),
        createdUtc: updated,
        numComments: 0,
        score: 0,
        matchedKeyword: kw,
      });
      if (out.length >= maxTotal) return out;
    }
  }
  return out;
}
