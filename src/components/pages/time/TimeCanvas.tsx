import { useTimeSetting } from "./useTimeConfig";
import { KEYS } from "@/lib/settings";
import { parseLayout, widgetsByRegion, DEFAULT_LAYOUT, type Region } from "./layout";
import { WIDGETS } from "./registry";
import { ClockBlock } from "./ClockBlock";

const GRID: Region[][] = [
  ["top-left", "top", "top-right"],
  ["left", "center", "right"],
  ["bottom-left", "bottom", "bottom-right"],
];

export function TimeCanvas() {
  const { value: layout } = useTimeSetting(KEYS.timeLayout, parseLayout, DEFAULT_LAYOUT);
  const byRegion = widgetsByRegion(layout);

  return (
    <div className="grid h-full grid-cols-3 grid-rows-3 gap-2 p-2">
      {GRID.flat().map((region) => (
        <div
          key={region}
          className="flex min-h-0 flex-col gap-2 overflow-y-auto [scrollbar-gutter:stable]"
        >
          {region === layout.clockRegion ? (
            <div className="flex flex-1 items-center justify-center">
              <ClockBlock />
            </div>
          ) : (
            byRegion[region].map((p) => {
              const meta = WIDGETS[p.id];
              return meta ? (
                <div key={p.id} className="min-h-0">
                  <meta.Component />
                </div>
              ) : null;
            })
          )}
        </div>
      ))}
    </div>
  );
}
