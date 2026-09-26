/** Generic JSON webhook — POSTs structured lead data for any integration. */
import type { EnrichedLead } from "../types.js";
import { appConfig } from "../appConfig.js";

export async function sendToWebhook(leads: EnrichedLead[]): Promise<void> {
  const url = process.env.GENERIC_WEBHOOK_URL;
  if (!url) {
    throw new Error(
      "GENERIC_WEBHOOK_URL is missing. Add it to .env.local or remove webhook from OUTPUT_CHANNELS."
    );
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app: appConfig.appName,
      count: leads.length,
      generatedAt: new Date().toISOString(),
      leads: leads.map((l) => ({
        id: l.post.id,
        source: l.post.source ?? "reddit",
        subreddit: l.post.subreddit,
        title: l.post.title,
        author: l.post.author,
        url: l.post.url,
        score: l.qualification.score,
        buyingIntent: l.qualification.buyingIntent,
        businessName: l.qualification.businessName,
        problem: l.qualification.problem,
        potentialSolution: l.qualification.potentialSolution,
        evidenceOfBuyingIntent: l.qualification.evidenceOfBuyingIntent,
        projectComplexity: l.qualification.projectComplexity,
        recommendedAction: l.qualification.recommendedAction,
      })),
    }),
  });
  if (!res.ok) {
    throw new Error(`Generic webhook failed: ${res.status} ${await res.text()}`);
  }
}
