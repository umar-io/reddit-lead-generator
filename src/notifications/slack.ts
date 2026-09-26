/**
 * Phases 6–9 — lead intelligence reports + Slack digest.
 * Low-level webhook sender lives in `../lib/slack.js` (reused as-is).
 */
import type { EnrichedLead } from "../types.js";
import { bucketForScore } from "../types.js";
import { sendToSlack } from "../lib/slack.js";
import { appConfig } from "../appConfig.js";

function priorityEmoji(score: number): string {
  const b = bucketForScore(score);
  if (b === "strong") return "🔥";
  if (b === "worth") return "🟠";
  if (b === "research") return "🟡";
  return "🔴";
}

function safe(s: string, max = 600): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Single-lead intelligence report (Phase 6 + 7 format). */
export function formatLeadReport(lead: EnrichedLead): string {
  const { post, qualification: q, conversation, enrichment } = lead;
  const lines: string[] = [];
  lines.push(`🚨 NEW ${appConfig.appName.toUpperCase()} LEAD`);
  lines.push("");
  lines.push(`${priorityEmoji(q.score)} Score: ${q.score}/100`);
  lines.push(`🎯 Buying intent: ${q.buyingIntent.toUpperCase()}`);
  lines.push("");
  lines.push("🏢 Business:");
  lines.push(
    safe(
      q.businessName ??
        enrichment?.businessName ??
        `u/${post.author} (business not named in post) — r/${post.subreddit}`
    )
  );
  lines.push("");
  lines.push("🔧 Problem:");
  lines.push(safe(q.problem));
  lines.push("");
  lines.push("💰 Buying signal:");
  lines.push(safe(q.evidenceOfBuyingIntent));
  lines.push("");
  lines.push("💡 Potential solution:");
  lines.push(safe(q.potentialSolution));
  lines.push("");
  lines.push("📊 Complexity:");
  lines.push(q.projectComplexity);
  if (enrichment?.businessDescription) {
    lines.push("");
    lines.push("🔎 Business context:");
    lines.push(safe(enrichment.businessDescription, 400));
  } else if (q.estimatedBusinessValue) {
    lines.push("");
    lines.push("🔎 Business context:");
    lines.push(safe(q.estimatedBusinessValue, 400));
  }
  if (conversation) {
    lines.push("");
    lines.push("💬 Conversation opportunity:");
    lines.push(safe(conversation.conversationContext, 400));
  }
  if (conversation?.usefulCommentOpportunity && conversation.suggestedComment) {
    lines.push("");
    lines.push("🗣 Suggested comment (DRAFT — manual review only, never auto-posted):");
    lines.push(`"${safe(conversation.suggestedComment, 800)}"`);
  }
  lines.push("");
  lines.push("🎯 Recommended next action:");
  lines.push(safe(q.recommendedAction, 400));
  lines.push("");
  lines.push(`💬 Why ${appConfig.business.name} could potentially help:`);
  lines.push(safe(q.reason, 400));
  lines.push("");
  lines.push(`🔗 Source: ${post.url}`);
  lines.push("");
  lines.push("_Lead research report — not an automated sales action._");
  return lines.join("\n");
}

/** Daily digest: one message summarizing all qualified leads (Phase 9). */
export function formatDigest(leads: EnrichedLead[]): string {
  const strong = leads.filter((l) => bucketForScore(l.qualification.score) === "strong").length;
  const worth = leads.filter((l) => bucketForScore(l.qualification.score) === "worth").length;
  const lines: string[] = [];
  lines.push(`${appConfig.appName.toUpperCase()} — DAILY LEADS`);
  lines.push("");
  lines.push(`🔥 ${strong} strong ${strong === 1 ? "opportunity" : "opportunities"}`);
  lines.push(`🟠 ${worth} worth investigating`);
  lines.push("");
  for (const lead of leads) {
    const { post, qualification: q } = lead;
    lines.push(
      `${priorityEmoji(q.score)} ${q.score} · ${q.buyingIntent.toUpperCase()} · ${q.projectComplexity} complexity`
    );
    lines.push(`r/${post.subreddit} — ${safe(post.title, 140)}`);
    lines.push(`Problem: ${safe(q.problem, 200)}`);
    if (q.businessName) lines.push(`Business: ${safe(q.businessName, 120)}`);
    lines.push(`🔗 ${post.url}`);
    lines.push("");
  }
  lines.push("_Research digest — review manually before any outreach._");
  return lines.join("\n");
}

export async function sendLeadReport(lead: EnrichedLead): Promise<void> {
  await sendToSlack(formatLeadReport(lead));
}

export async function sendDigest(leads: EnrichedLead[]): Promise<void> {
  if (leads.length === 0) {
    await sendToSlack(
      `${appConfig.appName.toUpperCase()} — DAILY LEADS\n\nNo qualified leads today (score >= threshold). _Research digest._`
    );
    return;
  }
  await sendToSlack(formatDigest(leads));
}
