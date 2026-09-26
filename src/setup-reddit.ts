/**
 * One-time Reddit OAuth setup helper (runs locally only).
 *
 *  1. Fill REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in .env.local first
 *     (from https://www.reddit.com/prefs/apps → "script" app).
 *  2. Run: npx tsx src/setup-reddit.ts
 *  3. Open the printed URL in your browser, click Approve.
 *  4. Copy the printed refresh token into .env.local as REDDIT_REFRESH_TOKEN.
 *
 * Nothing is posted or changed on your account — this only mints a
 * read-only token (scope: read, identity).
 */
import "./env.js";
import { createServer } from "node:http";

const clientId = process.env.REDDIT_CLIENT_ID;
const clientSecret = process.env.REDDIT_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(
    "❌ REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are empty in .env.local.\n" +
      "Create a 'script' app at https://www.reddit.com/prefs/apps first, then fill them in."
  );
  process.exit(1);
}

const redirectUri = process.env.REDDIT_REDIRECT_URI ?? "http://localhost:8080";
const port = Number(new URL(redirectUri).port || 8080);
const userAgent =
  process.env.REDDIT_USER_AGENT ??
  "windows:marz-lead-radar:1.0 (by /u/your-username)";

const state = Math.random().toString(36).slice(2);
const authUrl =
  "https://www.reddit.com/api/v1/authorize?" +
  new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    state,
    redirect_uri: redirectUri,
    duration: "permanent",
    scope: "read identity",
  });

console.log("\n1. Open this URL in your browser and click Approve:\n");
console.log(authUrl);
console.log(`\n2. Waiting for the redirect on ${redirectUri} ...\n`);

const code: string = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", redirectUri);
      const returnedState = url.searchParams.get("state");
      const authCode = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      if (err) {
        res.end("Denied. You can close this tab.");
        reject(new Error(`Reddit authorization failed: ${err}`));
      } else if (returnedState !== state || !authCode) {
        res.end("Invalid response. You can close this tab.");
        reject(new Error("State mismatch or missing code."));
      } else {
        res.end("Approved! You can close this tab and return to the terminal.");
        resolve(authCode);
      }
    } finally {
      server.close();
    }
  });
  server.on("error", reject);
  server.listen(port);
});

const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
const res = await fetch("https://www.reddit.com/api/v1/access_token", {
  method: "POST",
  headers: {
    Authorization: `Basic ${basic}`,
    "User-Agent": userAgent,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  }),
});
if (!res.ok) {
  console.error(`❌ Token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const json = (await res.json()) as { refresh_token?: string; error?: string };
if (!json.refresh_token) {
  console.error(`❌ No refresh token returned: ${JSON.stringify(json).slice(0, 200)}`);
  process.exit(1);
}

console.log("\n✅ Success! Add this to .env.local:\n");
console.log(`REDDIT_REFRESH_TOKEN=${json.refresh_token}\n`);
console.log("Then verify with: npm run pipeline:dry");
