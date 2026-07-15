import { describe, expect, it } from "vitest";
import {
  createNotificationHistoryLoader,
  nextNotificationVisibleCount,
  NOTIFICATION_PAGE_SIZE,
} from "../notification-history";

const items = [
  {
    id: "1",
    title: "done",
    body: null,
    source: "custom",
    level: "info",
    priority: "normal" as const,
    created_at: 1,
    read: false,
    action: null,
  },
];

describe("notification history loader", () => {
  it("grows visible history by twenty and caps at the actual total", () => {
    expect(NOTIFICATION_PAGE_SIZE).toBe(20);
    expect(nextNotificationVisibleCount(20, 55)).toBe(40);
    expect(nextNotificationVisibleCount(40, 55)).toBe(55);
    expect(nextNotificationVisibleCount(55, 55)).toBe(55);
  });

  it("clears cached history and accepts new notifications afterward", async () => {
    const loader = createNotificationHistoryLoader(async () => items);
    await loader.load();

    expect(loader.clear()).toEqual([]);
    await expect(loader.load()).resolves.toEqual([]);

    const incoming = { ...items[0], id: "2" };
    expect(loader.prepend(incoming)).toEqual([incoming]);
  });

  it("deduplicates compact and expanded remounts while preserving cached history", async () => {
    let calls = 0;
    let resolve!: (value: typeof items) => void;
    const request = new Promise<typeof items>((done) => {
      resolve = done;
    });
    const loader = createNotificationHistoryLoader(() => {
      calls += 1;
      return request;
    });

    const first = loader.load();
    const second = loader.load();
    expect(calls).toBe(1);

    resolve(items);
    await expect(first).resolves.toEqual(items);
    await expect(second).resolves.toEqual(items);
    await expect(loader.load()).resolves.toEqual(items);
    expect(calls).toBe(1);
  });
});
