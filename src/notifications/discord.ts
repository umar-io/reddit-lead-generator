/** Discord notifier — posts the same digest/report text via webhook. */
export async function sendToDiscord(message: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error(
      "DISCORD_WEBHOOK_URL is missing. Add it to .env.local or remove discord from OUTPUT_CHANNELS."
    );
  }
  if (!message.trim()) throw new Error("sendToDiscord: message must be non-empty");
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message.slice(0, 2000) }),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  }
}
