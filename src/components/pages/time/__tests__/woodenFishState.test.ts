import { describe, expect, it } from "vitest";
import { loadWoodenFishState, prepareWoodenFishKnock } from "../woodenFishState";

describe("loadWoodenFishState", () => {
  it("读取失败时保持不可交互，避免零值覆盖存量", async () => {
    const loaded = await loadWoodenFishState(
      async () => {
        throw new Error("IPC unavailable");
      },
      () => "2026-07-14",
    );

    expect(loaded).toEqual({
      state: {
        date: "2026-07-14",
        todayCount: 0,
        totalCount: 0,
        lastMilestone: null,
      },
      rolledOver: false,
      canInteract: false,
    });
  });

  it("旧日期存量会保留累计并标记需要落盘", async () => {
    const loaded = await loadWoodenFishState(
      async () =>
        JSON.stringify({
          date: "2026-07-13",
          todayCount: 9,
          totalCount: 100,
          lastMilestone: 10,
        }),
      () => "2026-07-14",
    );

    expect(loaded.state).toEqual({
      date: "2026-07-14",
      todayCount: 0,
      totalCount: 100,
      lastMilestone: null,
    });
    expect(loaded.rolledOver).toBe(true);
  });

  it("读取跨过午夜时使用读取完成后的日期", async () => {
    let day = "2026-07-13";
    const loaded = await loadWoodenFishState(
      async () => {
        day = "2026-07-14";
        return JSON.stringify({
          date: "2026-07-13",
          todayCount: 9,
          totalCount: 100,
          lastMilestone: 10,
        });
      },
      () => day,
    );

    expect(loaded.state).toEqual({
      date: "2026-07-14",
      todayCount: 0,
      totalCount: 100,
      lastMilestone: null,
    });
  });

  it("合法但字段畸形的 JSON 保持不可交互", async () => {
    const loaded = await loadWoodenFishState(
      async () =>
        JSON.stringify({
          date: "2026-07-14",
          todayCount: "9",
          totalCount: 100,
          lastMilestone: null,
        }),
      () => "2026-07-14",
    );

    expect(loaded.canInteract).toBe(false);
  });

  it("点击前按实时日期 rollover 后再累计", () => {
    const result = prepareWoodenFishKnock(
      {
        date: "2026-07-13",
        todayCount: 9,
        totalCount: 100,
        lastMilestone: null,
      },
      "2026-07-14",
    );

    expect(result.state).toMatchObject({
      date: "2026-07-14",
      todayCount: 1,
      totalCount: 101,
    });
  });

  it("无效 JSON 按空存量处理", async () => {
    const loaded = await loadWoodenFishState(async () => "not-json", () => "2026-07-14");
    expect(loaded.state.totalCount).toBe(0);
    expect(loaded.rolledOver).toBe(false);
  });
});
