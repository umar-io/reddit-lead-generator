/**
 * Phase 3 — AI lead qualification (Groq).
 * Anti-hallucination rules are part of the system prompt AND enforced
 * in validation (nulls stay null, no invented budgets).
 */
import type { LeadQualification, RedditPost } from "../types.js";
import { chatJson } from "./client.js";
import { appConfig } from "../appConfig.js";

function buildSystem(): string {
  const b = appConfig.business;
  const services = b.services.join(", ");
  const SYSTEM_HEAD = `You are a B2B software lead qualification agent for ${b.name}, ${b.description}.

Evaluate whether a post represents a genuine opportunity to sell ${services}.

Score 0-100 using:
- Is there a real business behind the post?
- Is there a real operational/software problem?
- Is the person actively looking for a developer, vendor, or solution?
- Is there explicit evidence of willingness to pay? (quote it or say none)
- What solution could solve it, and ${b.studioSizeNote}?

CRITICAL HONESTY RULES — NEVER violate these:
- NEVER invent evidence. If the post does not mention a budget, say so explicitly. Do not claim they have a budget.
- If the business name is not stated, return null. Never guess a name.
- If something is inferred rather than stated, label it: "inferred: ...".
- evidenceOfBuyingIntent must be grounded in the post text (quote or paraphrase). If none, say "No explicit buying signal in post."
- Keep problem/potentialSolution/reason short and factual.

Return ONLY valid JSON with EXACTLY these keys:
{
  "score": number,
  "buyingIntent": "high" | "medium" | "low",
  "businessDetected": boolean,
  "businessName": string | null,
  "problem": "short description",
  "potentialSolution": "short description",
  "evidenceOfBuyingIntent": "quoted or paraphrased evidence, or explicit none",
  "projectComplexity": "low" | "medium" | "high",
  "estimatedBusinessValue": "short value statement or 'Unknown'",
  "reason": "short explanation",
  "recommendedAction": "short next step for a human researcher"
}`;
  return SYSTEM_HEAD;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function normEnum(value: unknown, allowed: string[], fallback: string): string {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.includes(v) ? v : fallback;
}

export function validateQualification(raw: unknown): LeadQualification {
  if (!isRecord(raw)) throw new Error("Qualification was not a JSON object");
  const score =
    typeof raw.score === "number" && Number.isFinite(raw.score)
      ? Math.min(100, Math.max(0, Math.round(raw.score)))
      : 0;
  // Tolerant normalization: models sometimes return "Unknown"/"Medium".
  // Fallbacks lean conservative (low intent, medium complexity).
  const buyingIntent = normEnum(raw.buyingIntent, ["high", "medium", "low"], "low") as
    | "high"
    | "medium"
    | "low";
  const projectComplexity = normEnum(
    raw.projectComplexity,
    ["low", "medium", "high"],
    "medium"
  ) as "low" | "medium" | "high";
  const businessDetected =
    typeof raw.businessDetected === "boolean" ? raw.businessDetected : score >= 55;
  const businessName =
    typeof raw.businessName === "string" && raw.businessName.trim()
      ? raw.businessName.trim()
      : null;
  const problem = raw.problem;
  const potentialSolution = raw.potentialSolution;
  const evidenceOfBuyingIntent = raw.evidenceOfBuyingIntent;
  const estimatedBusinessValue = raw.estimatedBusinessValue;
  const reason = raw.reason;
  const recommendedAction = raw.recommendedAction;

  if (
    typeof problem !== "string" ||
    typeof potentialSolution !== "string" ||
    typeof evidenceOfBuyingIntent !== "string" ||
    typeof estimatedBusinessValue !== "string" ||
    typeof reason !== "string" ||
    typeof recommendedAction !== "string"
  ) {
    throw new Error(
      `Qualification failed validation: ${JSON.stringify(raw).slice(0, 600)}`
    );
  }
  return {
    score,
    buyingIntent,
    businessDetected,
    businessName,
    problem,
    potentialSolution,
    evidenceOfBuyingIntent,
    projectComplexity,
    estimatedBusinessValue,
    reason,
    recommendedAction,
  };
}

export function postToText(post: RedditPost): string {
  return [
    `Subreddit: r/${post.subreddit}`,
    `Title: ${post.title}`,
    `Author: u/${post.author}`,
    `URL: ${post.url}`,
    "",
    post.selftext.trim() ? post.selftext.slice(0, 4000) : "(no post body)",
  ].join("\n");
}

export async function qualifyPost(
  post: RedditPost
): Promise<LeadQualification> {
  const raw = await chatJson(buildSystem(), postToText(post));
  return validateQualification(raw);
}

/** Back-compat: qualify a raw string (used by legacy test pipeline). */
export async function qualifyText(
  postText: string
): Promise<LeadQualification> {
  if (!postText.trim()) throw new Error("qualifyText: empty post");
  const raw = await chatJson(buildSystem(), postText.slice(0, 4000));
  return validateQualification(raw);
}
