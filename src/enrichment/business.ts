/**
 * Phase 5 — Public business enrichment (conservative, business-level only).
 *
 * Allowed: company name / website / brand explicitly stated in the post,
 * plus the public homepage <title>/<meta description> of that website.
 *
 * FORBIDDEN: personal phones, private profiles, login-walled pages,
 * deanonymizing Reddit users, sensitive attributes, bulk personal data.
 * When in doubt → null + confidence "none".
 */
import type {
  BusinessEnrichment,
  RedditPost,
} from "../types.js";

const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Obvious personal-mail providers — never report these as "business email".
const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
]);

function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    try {
      const u = new URL(m[0].replace(/[.,;!?]+$/, ""));
      if (u.protocol === "http:" || u.protocol === "https:") {
        out.push(u.origin + (u.pathname !== "/" ? u.pathname : ""));
      }
    } catch {
      // ignore malformed
    }
  }
  return [...new Set(out)].slice(0, 3);
}

function extractPublicBusinessEmail(
  text: string,
  website: string | null
): string | null {
  const candidates = text.match(EMAIL_RE) ?? [];
  for (const email of candidates) {
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (PERSONAL_DOMAINS.has(domain)) continue;
    // Only report if it matches the stated business website domain.
    if (website) {
      try {
        const host = new URL(website).hostname.toLowerCase().replace(/^www\./, "");
        if (
          domain === host ||
          domain.endsWith(`.${host}`) ||
          host.endsWith(`.${domain}`)
        ) {
          return email;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function fetchHomepageMeta(
  website: string
): Promise<{ title: string | null; description: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(website, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "marz-lead-radar/1.0 (public business research; contact: Marz Studio)",
        Accept: "text/html",
      },
    });
    if (!res.ok) return { title: null, description: null };
    const html = (await res.text()).slice(0, 60_000);
    const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null;
    const desc =
      html.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i
      )?.[1]?.trim() ??
      html.match(
        /<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i
      )?.[1]?.trim() ??
      null;
    return { title, description: desc };
  } catch {
    return { title: null, description: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enrich a lead from PUBLIC business identifiers in the post text.
 * `businessName` comes from AI qualification (may be null).
 */
export async function enrichBusiness(
  post: RedditPost,
  businessName: string | null
): Promise<BusinessEnrichment> {
  const empty: BusinessEnrichment = {
    businessName: null,
    website: null,
    industry: null,
    businessDescription: null,
    publicContactPage: null,
    publicBusinessEmail: null,
    enrichmentConfidence: "none",
  };

  const text = `${post.title}\n${post.selftext}`;
  const urls = extractUrls(text);
  // Prefer a non-reddit URL as the business website.
  const website =
    urls.find((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase();
        return !h.includes("reddit.com") && !h.includes("redd.it");
      } catch {
        return false;
      }
    }) ?? null;

  if (!businessName && !website) return empty;

  let description: string | null = null;
  let confidence: BusinessEnrichment["enrichmentConfidence"] = "none";

  if (website) {
    const meta = await fetchHomepageMeta(website);
    description = meta.description ?? meta.title;
    confidence = description ? "medium" : "low";
  } else if (businessName) {
    // Name stated but no verifiable website in-post → low, description null.
    confidence = "low";
  }

  return {
    businessName: businessName ?? null,
    website,
    industry: null, // only set when publicly verified; homepage meta is not enough
    businessDescription: description,
    publicContactPage: website ? `${new URL(website).origin}/contact` : null,
    publicBusinessEmail: extractPublicBusinessEmail(text, website),
    enrichmentConfidence: confidence,
  };
}
