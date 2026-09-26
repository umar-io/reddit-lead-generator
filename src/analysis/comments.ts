/**
 * Phase 4 — Comment/conversation analysis (Groq).
 * Read-only: analyzes discussion to inform the human researcher.
 * NEVER auto-posts. Suggested comments are drafts for manual review only.
 */
import type {
  ConversationAnalysis,
  RedditComment,
  RedditPost,
} from "../types.js";
import { chatJson } from "../ai/client.js";

const SYSTEM = `You analyze a Reddit discussion around a potential software-project lead.
You receive the original post plus top comments.

Determine:
- Is the original poster (OP) responding and answering questions?
- Have they mentioned budget, company size, clarified requirements?
- Are they already considering a solution?
- Are other developers/vendors already pitching?
- What objections or constraints appear?

Then decide if a genuinely USEFUL human comment could add value, and draft it.

COMMENT RULES:
- The draft must contribute something relevant (architecture idea, scoping question, sequencing suggestion).
- It must be conversational and humble, never salesy.
- FORBIDDEN style: "Hi, I'm a developer. DM me." / pitching / self-promotion.
- If no useful comment angle exists, set usefulCommentOpportunity=false and suggestedComment="".
- The comment is a DRAFT for manual review. Never imply it was posted.

Return ONLY valid JSON:
{
  "conversationContext": "2-4 sentence summary of discussion state",
  "usefulCommentOpportunity": boolean,
  "suggestedComment": "draft text or empty string",
  "commentReason": "why this comment helps, or why none is appropriate"
}`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function validate(raw: unknown): ConversationAnalysis {
  if (!isRecord(raw)) throw new Error("Conversation analysis not an object");
  const { conversationContext, usefulCommentOpportunity, suggestedComment } =
    raw;
  const commentReason = raw.commentReason;
  if (
    typeof conversationContext !== "string" ||
    typeof usefulCommentOpportunity !== "boolean" ||
    typeof suggestedComment !== "string" ||
    typeof commentReason !== "string"
  ) {
    throw new Error(
      `Conversation analysis failed validation: ${JSON.stringify(raw).slice(0, 500)}`
    );
  }
  return {
    conversationContext,
    usefulCommentOpportunity,
    suggestedComment,
    commentReason,
  };
}

export async function analyzeConversation(
  post: RedditPost,
  comments: RedditComment[]
): Promise<ConversationAnalysis> {
  if (comments.length === 0) {
    return {
      conversationContext: `No comments retrieved for this post (${post.numComments} reported on Reddit).`,
      usefulCommentOpportunity: false,
      suggestedComment: "",
      commentReason: "No discussion to join yet.",
    };
  }
  const lines = comments.map(
    (c, i) =>
      `[${i + 1}] u/${c.author} (score ${c.score}): ${c.body.slice(0, 800)}`
  );
  const user = [
    `POST (u/${post.author}) r/${post.subreddit}: ${post.title}`,
    post.selftext.slice(0, 2000),
    "",
    "TOP COMMENTS:",
    ...lines,
  ].join("\n");
  const raw = await chatJson(SYSTEM, user, { temperature: 0.3 });
  return validate(raw);
}
