/**
 * Hacker News collector — official public API, no key needed.
 *
 * Uses the HN Algolia Search API (hn.algolia.com/api — the documented
 * search backend of Hacker News) for keyword discovery, plus the
 * Firebase-backed API (hacker-news.firebaseio.com) for top comments.
 * Both are free, read-only, and respect their rate limits (few requests
 * per run, 1s+ gaps). No scraping of the HTML site.
 */
import type { RedditComment, RedditPost } from "../types.js";
import { appConfig } from "../appConfig.js";

const SEARCH_BASE = "https://hn.algolia.com/api/v1/search";
const ITEM_BASE = "https://hn.algolia.com/api/v1/items";
const USER_AGENT = appConfig.sources.userAgent;

export const HN_KEYWORDS: string[] = appConfig.sources.hnKeywords;

interface HnHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  author?: string;
  story_text?: string | null;
  comment_text?: string | null;
  story_title?: string | null;
  story_url?: string | null;
  created_at_i?: number;
  points?: number;
  num_comments?: number;
  _tags?: string[];
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function getJson(url: string): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 1000));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HN request failed: ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function hitToPost(hit: HnHit, keyword: string): RedditPost | null {
  const isComment = (hit._tags ?? []).includes("comment");
  const title = hit.title ?? hit.story_title ?? "";
  const body = stripHtml(hit.story_text ?? hit.comment_text ?? "").slice(0, 1500);
  if (!title && !body) return null;
  // For comments, the item link points at the comment itself, which keeps
  // the lead URL useful for manual review.
  return {
    id: `hn_${hit.objectID}`,
    source: "hackernews",
    subreddit: "hackernews",
    title: title || body.slice(0, 140),
    author: hit.author ?? "[unknown]",
    selftext: body,
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    permalink: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    createdUtc: hit.created_at_i ?? 0,
    numComments: hit.num_comments ?? 0,
    score: hit.points ?? 0,
    matchedKeyword: keyword,
  };
}

/** Keyword search across HN stories + comments (recent first). */
export async function discoverHn(maxTotal = 10): Promise<RedditPost[]> {
  const seen = new Map<string, RedditPost>();
  const queries = HN_KEYWORDS.slice(0, 4); // keep the run small
  for (const q of queries) {
    let json: { hits?: HnHit[] };
    try {
      json = (await getJson(
        `${SEARCH_BASE}?query=${encodeURIComponent(q)}&tags=(story,comment)&hitsPerPage=10`
      )) as { hits?: HnHit[] };
    } catch (err) {
      console.warn(`⚠️ HN search failed "${q}": ${(err as Error).message}`);
      continue;
    }
    for (const hit of json.hits ?? []) {
      const post = hitToPost(hit, q);
      if (post && !seen.has(post.id)) seen.set(post.id, post);
      if (seen.size >= maxTotal) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

interface HnItem {
  id: number;
  children?: HnItem[];
  text?: string | null;
  author?: string;
  points?: number | null;
  created_at_i?: number;
}

/** Top-level comments for an HN story (best-effort, never throws). */
export async function fetchHnComments(
  post: RedditPost,
  limit = 6
): Promise<RedditComment[]> {
  const rawId = post.id.replace(/^hn_/, "");
  if (!/^\d+$/.test(rawId)) return [];
  try {
    const item = (await getJson(`${ITEM_BASE}/${rawId}`)) as HnItem;
    const out: RedditComment[] = [];
    for (const child of item.children ?? []) {
      if (!child.text) continue;
      const body = stripHtml(child.text).slice(0, 1500);
      if (!body.trim()) continue;
      out.push({
        id: `hn_c_${child.id}`,
        author: child.author ?? "[unknown]",
        body,
        score: child.points ?? 0,
        createdUtc: child.created_at_i ?? 0,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    console.warn(`⚠️ HN comments unavailable for ${post.id}: ${(err as Error).message}`);
    return [];
  }
}
