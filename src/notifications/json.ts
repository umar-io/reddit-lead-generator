/** JSON output — no webhook needed. Prints to stdout, appends to file when set. */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EnrichedLead } from "../types.js";
import { appConfig } from "../appConfig.js";

export async function writeLeadsJson(leads: EnrichedLead[]): Promise<void> {
  const payload = JSON.stringify(
    {
      app: appConfig.appName,
      count: leads.length,
      generatedAt: new Date().toISOString(),
      leads,
    },
    null,
    2
  );
  const file = appConfig.outputs.jsonFile;
  if (file) {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, payload + "\n", "utf8");
    console.log(`💾 ${leads.length} lead(s) appended to ${file}`);
  } else {
    console.log(payload);
  }
}
