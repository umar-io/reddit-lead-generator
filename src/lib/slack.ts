export async function sendToSlack(message: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error(
      "SLACK_WEBHOOK_URL is missing. Make sure src/env.ts ran first and .env.local contains SLACK_WEBHOOK_URL."
    );
  }

  if (!/^https:\/\/hooks\.slack\.com\//.test(webhookUrl)) {
    throw new Error("SLACK_WEBHOOK_URL does not look like a Slack webhook URL");
  }

  if (!message.trim()) {
    throw new Error("sendToSlack: message must be non-empty");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: message,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Slack webhook failed: ${response.status} ${await response.text()}`
    );
  }
}