/**
 * Deduplication store — MVP file-backed, Postgres-ready interface.
 *
 * To move to Postgres later: implement `LeadStore` with a table
 *   seen_posts(post_id TEXT PRIMARY KEY, url TEXT, seen_at TIMESTAMPTZ)
 * and swap `createLeadStore()` — callers only depend on the interface.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface LeadStore {
  has(postId: string): Promise<boolean>;
  markSeen(postId: string, url: string): Promise<void>;
  /** Filter a list down to unseen posts (preserves order). */
  filterUnseen<T extends { id: string }>(items: T[]): Promise<T[]>;
  size(): Promise<number>;
}

const DEFAULT_PATH = join(process.cwd(), "data", "seen-posts.json");

interface FileShape {
  seen: Record<string, { url: string; seenAt: string }>;
}

async function loadFile(path: string): Promise<FileShape> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    if (parsed && typeof parsed.seen === "object" && parsed.seen !== null) {
      return { seen: parsed.seen as FileShape["seen"] };
    }
    return { seen: {} };
  } catch {
    return { seen: {} };
  }
}

export class FileLeadStore implements LeadStore {
  private seen = new Map<string, { url: string; seenAt: string }>();
  private loaded = false;

  constructor(private path: string = DEFAULT_PATH) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const data = await loadFile(this.path);
    for (const [id, v] of Object.entries(data.seen)) {
      this.seen.set(id, v);
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const shape: FileShape = {
      seen: Object.fromEntries(this.seen),
    };
    // Atomic-ish write: tmp + rename would be nicer, plain write is fine for MVP.
    await writeFile(this.path, JSON.stringify(shape, null, 2), "utf8");
  }

  async has(postId: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.seen.has(postId);
  }

  async markSeen(postId: string, url: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.seen.has(postId)) {
      this.seen.set(postId, { url, seenAt: new Date().toISOString() });
      await this.persist();
    }
  }

  async filterUnseen<T extends { id: string }>(items: T[]): Promise<T[]> {
    await this.ensureLoaded();
    return items.filter((i) => !this.seen.has(i.id));
  }

  async size(): Promise<number> {
    await this.ensureLoaded();
    return this.seen.size;
  }
}

/** In-memory store for tests / ephemeral environments. */
export class MemoryLeadStore implements LeadStore {
  private seen = new Set<string>();
  async has(postId: string): Promise<boolean> {
    return this.seen.has(postId);
  }
  async markSeen(postId: string, _url?: string): Promise<void> {
    this.seen.add(postId);
  }
  async filterUnseen<T extends { id: string }>(items: T[]): Promise<T[]> {
    return items.filter((i) => !this.seen.has(i.id));
  }
  async size(): Promise<number> {
    return this.seen.size;
  }
}

export function createLeadStore(): LeadStore {
  // On Vercel the filesystem is ephemeral — use memory there so a failed
  // write never crashes the cron. Locally / with a volume, persist to disk.
  if (process.env.VERCEL === "1") return new MemoryLeadStore();
  const custom = process.env.SEEN_STORE_PATH;
  return new FileLeadStore(custom ?? DEFAULT_PATH);
}
