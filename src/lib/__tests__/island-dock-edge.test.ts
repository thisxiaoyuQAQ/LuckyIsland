import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDockEdgeSetting,
  getDockEdge,
} from "@/lib/island-dock-edge";
import { dockEdgeKey, parseDockEdge } from "@/lib/settings";

describe("DockEdge", () => {
  beforeEach(() => applyDockEdgeSetting("top"));

  it("normalizes missing and invalid values to top", () => {
    expect(parseDockEdge(null)).toBe("top");
    expect(parseDockEdge("diagonal")).toBe("top");
    expect(parseDockEdge("right")).toBe("right");
  });

  it("namespaces edge settings by UI mode", () => {
    expect(dockEdgeKey("island")).toBe("window:dock_edge:island");
    expect(dockEdgeKey("classisland")).toBe("window:dock_edge:classisland");
  });

  it("updates the module store with normalized values", () => {
    applyDockEdgeSetting("left");
    expect(getDockEdge()).toBe("left");
    applyDockEdgeSetting("bad");
    expect(getDockEdge()).toBe("top");
  });
});
