/**
 * General-use app config — makes lead-radar reusable for any agency/niche.
 *
 * Load order (first hit wins for the file itself):
 *   1. LEAD_RADAR_CONFIG env var (explicit path)
 *   2. ./lead-radar.config.json (project root)
 *   3. ./config/lead-radar.config.json
 *   4. Built-in defaults (the original Marz Studio values)
 *
 * Env vars always override the file for secrets + common knobs:
 *   APP_NAME, SUBREDDITS, KEYWORDS, HN_KEYWORDS, LEAD_SCORE_THRESHOLD,
 *   MAX_POSTS_PER_RUN, MAX_COMMENTS_PER_POST, REDDIT_ENABLED,
 *   OUTPUT_CHANNELS, OUTPUT_MODE, JSON_OUTPUT_FILE
 *
 * Copy lead-radar.config.example.json → lead-radar.config.json to start.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface BusinessProfile {
  name: string;
  description: string;
  services: string[];
  studioSizeNote: string;
}

export interface SourceConfig {
  subreddits: string[];
  keywords: string[];
  hnKeywords: string[];
  userAgent: string;
}

export type OutputChannel = "slack" | "discord" | "webhook" | "json";
export type OutputMode = "digest" | "per-lead";

export interface OutputsConfig {
  mode: OutputMode;
  channels: OutputChannel[];
  jsonFile: string | null;
}

export interface AppConfig {
  appName: string;
  business: BusinessProfile;
  sources: SourceConfig;
  outputs: OutputsConfig;
}

const DEFAULTS: AppConfig = {
  appName: "Lead Radar",
  business: {
    name: "your studio",
    description: "a small custom software development studio",
    services: [
      "custom software",
      "automation",
      "ERP",
      "CRM",
      "integrations",
      "internal tools",
      "inventory systems",
      "dashboards",
    ],
    studioSizeNote: "could a SMALL studio realistically deliver it?",
  },
  sources: {
    subreddits: [
      "Shopify",
      "ecommerce",
      "InventoryManagement",
      "3PL",
      "smallbusiness",
      "ERP",
    ],
    keywords: [
      "looking for developer",
      "need a developer",
      "looking for someone to build",
      "custom software",
      "custom ERP",
      "build ERP",
      "internal tool",
      "inventory system",
      "inventory software",
      "warehouse software",
      "automation",
      "API integration",
      "Shopify integration",
      "CRM",
      "business management system",
      "software developer",
      "need software",
    ],
    hnKeywords: [
      "looking for developer",
      "need developer",
      "custom ERP",
      "custom software",
      "inventory software",
      "internal tool",
      "need software built",
      "freelance developer",
    ],
    userAgent: "lead-radar/1.0 (read-only lead research)",
  },
  outputs: {
    mode: "digest",
    channels: ["slack"],
    jsonFile: null,
  },
};

function csvEnv(name: string): string[] | null {
  const raw = process.env[name];
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function loadFile(): Partial<AppConfig> {
  // --config=path works even though config loads at import time,
  // because process.argv is populated before imports run.
  const flag = process.argv
    .find((a) => a.startsWith("--config="))
    ?.split("=")[1];
  const candidates = [
    flag,
    process.env.LEAD_RADAR_CONFIG,
    join(process.cwd(), "lead-radar.config.json"),
    join(process.cwd(), "config", "lead-radar.config.json"),
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<AppConfig>;
      return parsed ?? {};
    } catch (err) {
      console.warn(
        `⚠️ Could not parse config at ${path}: ${(err as Error).message} — using defaults`
      );
    }
  }
  return {};
}

function build(): AppConfig {
  const file = loadFile();
  const appName = process.env.APP_NAME ?? file.appName ?? DEFAULTS.appName;
  const channelsRaw = (
    process.env.OUTPUT_CHANNELS ??
    file.outputs?.channels?.join(",") ??
    ""
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is OutputChannel =>
      s === "slack" || s === "discord" || s === "webhook" || s === "json"
    );
  const modeRaw = (
    process.env.OUTPUT_MODE ??
    file.outputs?.mode ??
    DEFAULTS.outputs.mode
  ).toLowerCase();

  return {
    appName,
    business: {
      name: file.business?.name ?? DEFAULTS.business.name,
      description: file.business?.description ?? DEFAULTS.business.description,
      services:
        file.business?.services && file.business.services.length > 0
          ? file.business.services
          : DEFAULTS.business.services,
      studioSizeNote:
        file.business?.studioSizeNote ?? DEFAULTS.business.studioSizeNote,
    },
    sources: {
      subreddits:
        csvEnv("SUBREDDITS") ??
        (file.sources?.subreddits?.length ? file.sources.subreddits : DEFAULTS.sources.subreddits),
      keywords:
        csvEnv("KEYWORDS") ??
        (file.sources?.keywords?.length ? file.sources.keywords : DEFAULTS.sources.keywords),
      hnKeywords:
        csvEnv("HN_KEYWORDS") ??
        (file.sources?.hnKeywords?.length ? file.sources.hnKeywords : DEFAULTS.sources.hnKeywords),
      userAgent:
        process.env.REDDIT_USER_AGENT ??
        file.sources?.userAgent ??
        `${appName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/1.0 (read-only lead research)`,
    },
    outputs: {
      mode: modeRaw === "per-lead" ? "per-lead" : "digest",
      channels: channelsRaw.length > 0 ? channelsRaw : DEFAULTS.outputs.channels,
      jsonFile:
        process.env.JSON_OUTPUT_FILE ?? file.outputs?.jsonFile ?? DEFAULTS.outputs.jsonFile,
    },
  };
}

export const appConfig: AppConfig = build();
