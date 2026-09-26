import dotenv from "dotenv";

// `import "dotenv/config"` only loads `.env`, but this project keeps
// secrets in `.env.local`. Load `.env.local` first (highest priority),
// then fall back to `.env` without overriding values already set.
dotenv.config({ path: ".env.local" });
dotenv.config();

const required = ["GROQ_API_KEY", "SLACK_WEBHOOK_URL"] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(
      `[env] Missing required environment variable: ${key}. ` +
        `Check .env.local exists and contains ${key}.`
    );
  }
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
  /** Only send leads >= threshold to Slack by default. */
  leadScoreThreshold: intEnv("LEAD_SCORE_THRESHOLD", 70),
  /** Caps per scheduled run to respect Reddit + Groq rate limits. */
  maxPostsPerRun: intEnv("MAX_POSTS_PER_RUN", 12),
  maxCommentsPerPost: intEnv("MAX_COMMENTS_PER_POST", 8),
  redditEnabled: (process.env.REDDIT_ENABLED ?? "true").toLowerCase() === "true",
};