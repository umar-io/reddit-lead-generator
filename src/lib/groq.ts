/**
 * Legacy compat wrapper — kept so the existing pipeline keeps working.
 * New code should import from `../ai/qualifier.js` + `../types.js` directly.
 */
export type { LeadQualification } from "../types.js";
import type { LeadQualification } from "../types.js";
import { qualifyText } from "../ai/qualifier.js";

/** Qualify a raw post string (legacy signature). */
export async function qualifyLead(post: string): Promise<LeadQualification> {
  if (!post || !post.trim()) {
    throw new Error("qualifyLead: post must be a non-empty string");
  }
  return qualifyText(post);
}
