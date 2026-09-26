import type { VercelRequest, VercelResponse } from "@vercel/node";
import "../../src/env.js";
import { config } from "../../src/env.js";
import { qualifyLead } from "../../src/lib/groq.js";
import { sendLeadReport } from "../../src/notifications/slack.js";

/**
 * Legacy cron route — kept for backward compatibility.
 * Prefer GET /api/cron/leads (full discovery + digest).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const text =
    typeof req.body?.post === "string" && req.body.post.trim()
      ? req.body.post
      : `I'm the owner of a growing distribution business with three warehouses.
We're currently using Excel to track inventory because our existing
software doesn't handle our workflow properly.

We're looking for a developer who can build us a custom ERP system
covering inventory, orders, purchasing and reporting.

We're willing to pay for the right solution.`;

  try {
    const qualification = await qualifyLead(text);
    if (qualification.score < config.leadScoreThreshold) {
      return res.status(200).json({ ok: true, skipped: true, lead: qualification });
    }
    await sendLeadReport({
      post: {
        id: "manual",
        subreddit: "manual",
        title: "Manual test lead",
        author: "manual",
        selftext: text,
        url: "https://www.reddit.com/",
        permalink: "/",
        createdUtc: Date.now() / 1000,
        numComments: 0,
        score: 0,
      },
      qualification,
      conversation: null,
      enrichment: null,
    });
    return res.status(200).json({ ok: true, lead: qualification });
  } catch (error) {
    console.error("Lead cron failed:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
