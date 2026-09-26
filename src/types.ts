/**
 * lead-radar — shared types.
 * Read-only research tool. Never auto-posts, DMs, or comments.
 */

export type BuyingIntent = "high" | "medium" | "low";
export type ProjectComplexity = "low" | "medium" | "high";
export type EnrichmentConfidence = "high" | "medium" | "low" | "none";

// ---------------------------------------------------------------- Reddit ---

export interface RedditPost {
  /** Stable Reddit base36 id, e.g. "1abc23" */
  id: string;
  /** Discovery source. Defaults to "reddit" when omitted. */
  source?: "reddit" | "hackernews";
  subreddit: string;
  title: string;
  author: string;
  selftext: string;
  /** Full Reddit URL, e.g. https://www.reddit.com/r/ERP/comments/abc/post/ */
  url: string;
  permalink: string;
  createdUtc: number;
  numComments: number;
  score: number;
  /** Which keyword query surfaced this post (for debugging) */
  matchedKeyword?: string;
}

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
}

// ------------------------------------------------------- AI qualification ---

export interface LeadQualification {
  score: number; // 0-100
  buyingIntent: BuyingIntent;
  businessDetected: boolean;
  businessName: string | null;
  problem: string;
  potentialSolution: string;
  /** Verbatim-grounded buying evidence. Never invented. */
  evidenceOfBuyingIntent: string;
  projectComplexity: ProjectComplexity;
  estimatedBusinessValue: string;
  reason: string;
  recommendedAction: string;
}

// ------------------------------------------------- Comment/conversation -----

export interface ConversationAnalysis {
  conversationContext: string;
  usefulCommentOpportunity: boolean;
  /** Draft for MANUAL review only. Never auto-posted. */
  suggestedComment: string;
  commentReason: string;
}

// ------------------------------------------------------------ Enrichment ---

export interface BusinessEnrichment {
  businessName: string | null;
  website: string | null;
  industry: string | null;
  businessDescription: string | null;
  publicContactPage: string | null;
  publicBusinessEmail: string | null;
  enrichmentConfidence: EnrichmentConfidence;
}

// ------------------------------------------------------------------ Lead ---

export interface EnrichedLead {
  post: RedditPost;
  qualification: LeadQualification;
  conversation: ConversationAnalysis | null;
  enrichment: BusinessEnrichment | null;
}

// ---------------------------------------------------------------- Priority ---

export type LeadBucket = "strong" | "worth" | "research" | "ignore";

export function bucketForScore(score: number): LeadBucket {
  if (score >= 85) return "strong";
  if (score >= 70) return "worth";
  if (score >= 55) return "research";
  return "ignore";
}

export function bucketLabel(bucket: LeadBucket): string {
  switch (bucket) {
    case "strong":
      return "🔥 85–100 = Strong buying signal";
    case "worth":
      return "🟠 70–84 = Worth investigating";
    case "research":
      return "🟡 55–69 = Research only";
    case "ignore":
      return "🔴 <55 = Ignore";
  }
}
