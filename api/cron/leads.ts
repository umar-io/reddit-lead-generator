import type { VercelRequest, VercelResponse } from "@vercel/node";
import "../../src/env.js";
import { runLive } from "../../src/pipeline.js";

/**
 * Vercel Cron — GET /api/cron/leads
 * Runs discovery → qualification → fan-out to configured outputs.
 * Read-only on Reddit/HN; outbound calls are output channels only.
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
  try {
    const leads = await runLive({ dryRun: false, limit: 12 });
    return res.status(200).json({
      ok: true,
      count: leads.length,
      leads: leads.map((l) => ({
        id: l.post.id,
        subreddit: l.post.subreddit,
        title: l.post.title,
        url: l.post.url,
        score: l.qualification.score,
        buyingIntent: l.qualification.buyingIntent,
      })),
    });
  } catch (error) {
    console.error("Cron /api/cron/leads failed:", error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
