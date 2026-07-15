import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  title?: string;
  date?: string;
  notes?: string;
  releaseUrl: string;
  downloaded: number;
  total?: number;
  error?: string;
  pendingAvailable: boolean;
  fullscreenBlocked: boolean;
}

export interface UpdateResource {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  rawJson: Record<string, unknown>;
  close(): Promise<void>;
  downloadAndInstall(onEvent?: (event: DownloadEvent) => void): Promise<void>;
}

export interface UpdateAdapter {
  check(): Promise<UpdateResource | null>;
  currentVersion?(): Promise<string>;
}

export interface UpdateStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): UpdateState;
  checkForUpdate(origin: "auto" | "manual"): Promise<void>;
  installAvailableUpdate(): Promise<void>;
  setFullscreenBlocked(blocked: boolean): void;
  acknowledgeAvailable(): void;
}

const FALLBACK_RELEASE_URL = "https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/latest";
const RELEASE_PATH_PREFIX = "/thisxiaoyuQAQ/LuckyIsland/releases/";

export function resolveReleaseUrl(raw: Record<string, unknown>): string {
  const candidate = raw.releaseUrl ?? raw.html_url;
  if (typeof candidate !== "string") return FALLBACK_RELEASE_URL;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith(RELEASE_PATH_PREFIX)
      ? url.toString()
      : FALLBACK_RELEASE_URL;
  } catch {
    return FALLBACK_RELEASE_URL;
  }
}

export function redactUpdateError(reason: unknown): string {
  let message = reason instanceof Error ? reason.message : String(reason);
  message = message
    .replace(/Authorization\s*:\s*(?:Bearer\s+)?[^\s,;]+/gi, "Authorization: [已脱敏]")
    .replace(/TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?\s*=\s*[^\s,;]+/gi, "[已脱敏]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[已脱敏]")
    .replace(/[A-Za-z]:[\\/](?:Users|用户)[\\/][^\\/\s]+[\\/][^\s,;]*/gi, "[已脱敏]")
    .replace(/\/(?:home|Users)\/[^/\s]+\/[^\s,;]*/g, "[已脱敏]");
  return message;
}

function metadataTitle(update: UpdateResource): string | undefined {
  const title = update.rawJson.title ?? update.rawJson.name;
  return typeof title === "string" ? title : undefined;
}

export function createUpdateStore(
  adapter: UpdateAdapter,
  initialVersion = "未知",
): UpdateStore {
  let state: UpdateState = {
    phase: "idle",
    currentVersion: initialVersion,
    releaseUrl: FALLBACK_RELEASE_URL,
    downloaded: 0,
    pendingAvailable: false,
    fullscreenBlocked: false,
  };
  let activeUpdate: UpdateResource | null = null;
  let requestGeneration = 0;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  const closeResource = async (resource: UpdateResource | null) => {
    if (!resource) return;
    try {
      await resource.close();
    } catch (error) {
      console.error("[updater] 释放更新资源失败:", redactUpdateError(error));
    }
  };

  const replaceResource = async (next: UpdateResource | null) => {
    const previous = activeUpdate;
    activeUpdate = next;
    if (previous && previous !== next) await closeResource(previous);
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return state;
    },
    async checkForUpdate(_origin) {
      if (state.phase === "downloading" || state.phase === "installing") return;
      const generation = ++requestGeneration;
      publish({ phase: "checking", error: undefined, downloaded: 0, total: undefined });
      try {
        const currentVersion = adapter.currentVersion
          ? await adapter.currentVersion().catch(() => state.currentVersion)
          : state.currentVersion;
        const update = await adapter.check();
        if (generation !== requestGeneration) {
          await closeResource(update);
          return;
        }
        if (!update) {
          await replaceResource(null);
          publish({
            phase: "up_to_date",
            currentVersion,
            latestVersion: undefined,
            title: undefined,
            date: undefined,
            notes: undefined,
            releaseUrl: FALLBACK_RELEASE_URL,
            pendingAvailable: false,
          });
          return;
        }
        await replaceResource(update);
        publish({
          phase: "available",
          currentVersion: update.currentVersion || currentVersion,
          latestVersion: update.version,
          title: metadataTitle(update),
          date: update.date,
          notes: update.body,
          releaseUrl: resolveReleaseUrl(update.rawJson),
          downloaded: 0,
          total: undefined,
          pendingAvailable: true,
        });
      } catch (error) {
        if (generation !== requestGeneration) return;
        await replaceResource(null);
        publish({ phase: "error", error: redactUpdateError(error), pendingAvailable: false });
      }
    },
    async installAvailableUpdate() {
      const update = activeUpdate;
      if (!update || state.phase !== "available") return;
      publish({ phase: "downloading", downloaded: 0, total: undefined, error: undefined });
      try {
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            publish({ total: event.data.contentLength, downloaded: 0 });
          } else if (event.event === "Progress") {
            publish({ downloaded: state.downloaded + event.data.chunkLength });
          } else if (event.event === "Finished") {
            publish({ phase: "installing" });
          }
        });
      } catch (error) {
        if (activeUpdate === update) activeUpdate = null;
        await closeResource(update);
        publish({ phase: "error", error: redactUpdateError(error) });
      }
    },
    setFullscreenBlocked(blocked) {
      publish({ fullscreenBlocked: blocked });
    },
    acknowledgeAvailable() {
      if (state.phase === "available") publish({ pendingAvailable: false });
    },
  };
}

export class AutoCheckGate {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempted = false;

  constructor(
    private readonly attempt: () => Promise<void>,
    private readonly delayMs = 10_000,
  ) {}

  schedule(enabled: boolean): () => void {
    if (!enabled) {
      this.cancelPending();
      return () => undefined;
    }
    if (!this.attempted && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.attempted) return;
        this.attempted = true;
        void this.attempt();
      }, this.delayMs);
    }
    return () => this.cancelPending();
  }

  private cancelPending() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

const defaultAdapter: UpdateAdapter = {
  check: () => check() as Promise<Update | null>,
  currentVersion: getVersion,
};
const defaultStore = createUpdateStore(defaultAdapter);
const autoCheckGate = new AutoCheckGate(() => defaultStore.checkForUpdate("auto"));

export const subscribeUpdate = defaultStore.subscribe;
export const getUpdateSnapshot = defaultStore.getSnapshot;
export const checkForUpdate = defaultStore.checkForUpdate;
export const installAvailableUpdate = defaultStore.installAvailableUpdate;
export const setUpdateFullscreenBlocked = defaultStore.setFullscreenBlocked;
export const acknowledgeAvailableUpdate = defaultStore.acknowledgeAvailable;
export function scheduleAutoCheck(enabled: boolean): () => void {
  return autoCheckGate.schedule(enabled);
}
