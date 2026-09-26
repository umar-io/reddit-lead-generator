import dotenv from "dotenv";

// `import "dotenv/config"` only loads `.env`, but this project keeps
// secrets in `.env.local`. Load `.env.local` first (highest priority),
// then fall back to `.env` without overriding values already set.
dotenv.config({ path: ".env.local" });
dotenv.config();

const required = ["GROQ_API_KEY"] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(
      `[env] Missing required environment variable: ${key}. ` +
        `Copy .env.example to .env.local and fill it in.`
    );
  }
}

// At least one output channel must be usable. "json" needs no URL —
// it prints to stdout (or JSON_OUTPUT_FILE when set).
const hasOutput =
  process.env.SLACK_WEBHOOK_URL ||
  process.env.DISCORD_WEBHOOK_URL ||
  process.env.GENERIC_WEBHOOK_URL ||
  (process.env.OUTPUT_CHANNELS ?? "slack").split(",").includes("json") ||
  process.env.JSON_OUTPUT_FILE;

if (!hasOutput) {
  throw new Error(
    `[env] No output configured. Set at least one of: SLACK_WEBHOOK_URL, ` +
      `DISCORD_WEBHOOK_URL, GENERIC_WEBHOOK_URL, or OUTPUT_CHANNELS=json / JSON_OUTPUT_FILE.`
  );
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
  /** Only send leads >= threshold to outputs by default. */
  leadScoreThreshold: intEnv("LEAD_SCORE_THRESHOLD", 70),
  /** Caps per scheduled run to respect Reddit + Groq rate limits. */
  maxPostsPerRun: intEnv("MAX_POSTS_PER_RUN", 12),
  maxCommentsPerPost: intEnv("MAX_COMMENTS_PER_POST", 8),
  redditEnabled: (process.env.REDDIT_ENABLED ?? "true").toLowerCase() === "true",
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? null,
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? null,
  genericWebhookUrl: process.env.GENERIC_WEBHOOK_URL ?? null,
};