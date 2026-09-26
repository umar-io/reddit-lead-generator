/**
 * Pluggable output dispatcher — fans out to every configured channel.
 * Channels come from lead-radar.config.json (`outputs.channels`),
 * overridden by OUTPUT_CHANNELS env var. Supported: slack, discord,
 * webhook, json. Email is intentionally not built in — point `webhook`
 * at Zapier/Make/Resend, or run with `json` and feed your mailer.
 */
import type { EnrichedLead } from "../types.js";
import { appConfig } from "../appConfig.js";
import { formatDigest, formatLeadReport, sendDigest, sendLeadReport } from "./slack.js";
import { sendToDiscord } from "./discord.js";
import { sendToWebhook } from "./webhook.js";
import { writeLeadsJson } from "./json.js";

function textsFor(leads: EnrichedLead[]): { digest: string; reports: string[] } {
  return {
    digest: formatDigest(leads),
    reports: leads.map(formatLeadReport),
  };
}

/** Send qualified leads to all configured channels. Honors outputs.mode. */
export async function sendLeads(leads: EnrichedLead[]): Promise<void> {
  const channels = appConfig.outputs.channels;
  const { digest, reports } = textsFor(leads);
  const perLead = appConfig.outputs.mode === "per-lead";

  for (const channel of channels) {
    if (channel === "slack") {
      if (perLead) {
        for (const lead of leads) await sendLeadReport(lead);
        if (leads.length === 0) await sendDigest([]);
      } else {
        await sendDigest(leads);
      }
    } else if (channel === "discord") {
      if (perLead) {
        for (const text of reports) await sendToDiscord(text);
        if (leads.length === 0) await sendToDiscord(digest);
      } else {
        await sendToDiscord(digest);
      }
    } else if (channel === "webhook") {
      await sendToWebhook(leads);
    } else if (channel === "json") {
      await writeLeadsJson(leads);
    }
  }
}

/** Single-lead path (test CLI, legacy routes) — same fan-out. */
export async function sendSingleLead(lead: EnrichedLead): Promise<void> {
  await sendLeads([lead]);
}
