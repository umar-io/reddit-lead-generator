/**
 * Reddit collector — READ-ONLY lead discovery via official access methods.
 *
 * Priority order (all official / API-supported):
 *  1. OAuth (script app): REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET +
 *     REDDIT_USERNAME + REDDIT_PASSWORD → api/v1/access_token, then
 *     oauth.reddit.com. This is the reliable path — Reddit blocks
 *     anonymous requests (403) from many networks/datacenters.
 *  2. Pre-supplied REDDIT_BEARER_TOKEN (e.g. minted by your own tooling).
 *  3. Anonymous public .json fallback (often 403 — handled gracefully).
 *
 * Rules enforced here:
 *  - GET only. Never posts, comments, votes, DMs, or mod actions.
 *  - Polite descriptive User-Agent, 1.2s+ delay between requests, small caps.
 *  - 429/5xx = back off, not retried aggressively.
 */
import type { RedditComment, RedditPost } from "../types.js";
import { appConfig } from "../appConfig.js";

/**
 * Target subs + keywords come from lead-radar.config.json
 * (SUBREDDITS / KEYWORDS env vars override). Defaults preserve the
 * original behavior. Import from appConfig for new code; these
 * re-exports stay for backward compatibility.
 */
export const SUBREDDITS: string[] = appConfig.sources.subreddits;

export const KEYWORDS: string[] = appConfig.sources.keywords;

const USER_AGENT = appConfig.sources.userAgent;

const REQUEST_GAP_MS = 1200;
let lastRequestAt = 0;

// --- Official OAuth (script app, password grant) ----------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

function oauthCreds(): {
  id: string;
  secret: string;
  username: string;
  password: string;
} | null {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } =
    process.env;
  if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET && REDDIT_USERNAME && REDDIT_PASSWORD) {
    return {
      id: REDDIT_CLIENT_ID,
      secret: REDDIT_CLIENT_SECRET,
      username: REDDIT_USERNAME,
      password: REDDIT_PASSWORD,
    };
  }
  return null;
}

async function requestToken(body: URLSearchParams, basic: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`⚠️ Reddit OAuth token failed: ${res.status} — check app credentials`);
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    cachedToken = {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return cachedToken.token;
  } catch (err) {
    console.warn(`⚠️ Reddit OAuth token error: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Mint/refresh an OAuth token via Reddit's official token endpoint. */
async function getOAuthToken(): Promise<string | null> {
  if (process.env.REDDIT_BEARER_TOKEN) return process.env.REDDIT_BEARER_TOKEN;
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN } = process.env;
  // Personal-use script with a permanent refresh token (preferred).
  if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET && REDDIT_REFRESH_TOKEN) {
    const basic = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64");
    return requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: REDDIT_REFRESH_TOKEN,
      }),
      basic
    );
  }
  // Script-app password grant fallback.
  const creds = oauthCreds();
  if (!creds) return null;
  const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString("base64");
  return requestToken(
    new URLSearchParams({
      grant_type: "password",
      username: creds.username,
      password: creds.password,
    }),
    basic
  );
}

async function politeDelay(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < REQUEST_GAP_MS) {
    await new Promise((r) => setTimeout(r, REQUEST_GAP_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

async function fetchJson(url: string): Promise<unknown> {
  await politeDelay();
  // Prefer authenticated endpoints (oauth.reddit.com) when we have a token —
  // anonymous www.reddit.com/.json is 403-blocked on many networks.
  const token = await getOAuthToken();
  const authedUrl = token
    ? url.replace("https://www.reddit.com", "https://oauth.reddit.com")
    : url;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.status === 429) {
      throw new Error(`Reddit rate-limited (429) for ${url} — backing off`);
    }
    if (!res.ok) {
      throw new Error(`Reddit request failed: ${res.status} for ${url}`);
    }
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

interface RedditListingChild {
  kind: string;
  data: {
    id: string;
    subreddit: string;
    title?: string;
    author?: string;
    selftext?: string;
    permalink?: string;
    url?: string;
    created_utc?: number;
    num_comments?: number;
    score?: number;
    stickied?: boolean;
    over_18?: boolean;
  };
}

function toPost(
  child: RedditListingChild,
  matchedKeyword?: string
): RedditPost | null {
  const d = child.data;
  if (!d.id || !d.title || d.stickied) return null;
  const permalink: string = d.permalink ?? `/r/${d.subreddit}/comments/${d.id}/`;
  return {
    id: d.id,
    subreddit: d.subreddit,
    title: d.title,
    author: d.author ?? "[unknown]",
    selftext: d.selftext ?? "",
    url: d.url?.startsWith("http")
      ? d.url
      : `https://www.reddit.com${permalink}`,
    permalink,
    createdUtc: d.created_utc ?? 0,
    numComments: d.num_comments ?? 0,
    score: d.score ?? 0,
    matchedKeyword,
  };
}

async function searchSubreddit(
  sub: string,
  keyword: string,
  limit: number
): Promise<RedditPost[]> {
  const q = encodeURIComponent(keyword);
  const url =
    `https://www.reddit.com/r/${sub}/search.json` +
    `?q=${q}&restrict_sr=1&sort=new&t=month&limit=${limit}`;
  try {
    const json = (await fetchJson(url)) as {
      data?: { children?: RedditListingChild[] };
    };
    const children = json.data?.children ?? [];
    return children
      .map((c) => toPost(c, keyword))
      .filter((p): p is RedditPost => p !== null);
  } catch (err) {
    console.warn(
      `⚠️ Reddit search failed r/${sub} "${keyword}": ${(err as Error).message}`
    );
    return [];
  }
}

async function fetchNew(
  sub: string,
  limit: number
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${sub}/new.json?limit=${limit}`;
  try {
    const json = (await fetchJson(url)) as {
      data?: { children?: RedditListingChild[] };
    };
    return (json.data?.children ?? [])
      .map((c) => toPost(c))
      .filter((p): p is RedditPost => p !== null);
  } catch (err) {
    console.warn(
      `⚠️ Reddit /new failed r/${sub}: ${(err as Error).message}`
    );
    return [];
  }
}

function matchesKeyword(p: RedditPost): string | undefined {
  const hay = `${p.title}\n${p.selftext}`.toLowerCase();
  return (KEYWORDS as readonly string[]).find((k) =>
    hay.includes(k.toLowerCase())
  );
}

export interface DiscoverOptions {
  /** Cap on search results per (sub, keyword) query. Default 10. */
  limitPerQuery?: number;
  /** How many /new posts to scan per sub as keyword fallback. Default 25. */
  newPerSub?: number;
  /** Max keywords to query per sub (keeps run small). Default 6. */
  keywordsPerSub?: number;
  /** Overall cap. Default 30. */
  maxTotal?: number;
}

/**
 * Discover candidate posts across target subs.
 * Keyword search first, then /new scan filtered by keywords as fallback.
 * Pure discovery — AI qualification happens downstream.
 */
export async function discoverPosts(
  opts: DiscoverOptions = {}
): Promise<RedditPost[]> {
  const {
    limitPerQuery = 10,
    newPerSub = 25,
    keywordsPerSub = 6,
    maxTotal = 30,
  } = opts;

  const seen = new Map<string, RedditPost>();
  // Rotate keywords per sub so repeated runs cover different ground
  // without hammering the API.
  const offset = Math.floor(Date.now() / 3_600_000) % KEYWORDS.length;

  for (const sub of SUBREDDITS) {
    for (let i = 0; i < keywordsPerSub; i++) {
      const keyword = KEYWORDS[(offset + i) % KEYWORDS.length]!;
      const posts = await searchSubreddit(sub, keyword, limitPerQuery);
      for (const p of posts) {
        if (!seen.has(p.id)) seen.set(p.id, p);
        if (seen.size >= maxTotal) return [...seen.values()];
      }
    }
    // Fallback: scan /new and keep keyword-matching posts the search missed.
    const fresh = await fetchNew(sub, newPerSub);
    for (const p of fresh) {
      if (seen.has(p.id)) continue;
      const kw = matchesKeyword(p);
      if (kw) {
        seen.set(p.id, { ...p, matchedKeyword: kw });
        if (seen.size >= maxTotal) return [...seen.values()];
      }
    }
  }
  return [...seen.values()];
}

/**
 * Fetch top-level comments for a post (read-only).
 * Returns [] when comments are disabled/unavailable — never throws.
 */
export async function fetchPostComments(
  post: RedditPost,
  limit = 8
): Promise<RedditComment[]> {
  const url = `https://www.reddit.com${post.permalink}.json?limit=50&sort=top`;
  try {
    const json = (await fetchJson(url)) as Array<{
      data?: {
        children?: Array<{
          kind: string;
          data?: {
            id?: string;
            author?: string;
            body?: string;
            score?: number;
            created_utc?: number;
          };
        }>;
      };
    }>;
    const listing = json[1]?.data?.children ?? [];
    return listing
      .filter((c) => c.kind === "t1" && c.data?.body)
      .map((c) => ({
        id: c.data!.id ?? "",
        author: c.data!.author ?? "[unknown]",
        body: (c.data!.body ?? "").slice(0, 2000),
        score: c.data!.score ?? 0,
        createdUtc: c.data!.created_utc ?? 0,
      }))
      .filter((c) => c.id && c.body.trim())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (err) {
    console.warn(
      `⚠️ Comments unavailable for ${post.id}: ${(err as Error).message}`
    );
    return [];
  }
}
