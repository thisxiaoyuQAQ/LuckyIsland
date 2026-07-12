import { useTimeSetting } from "./useTimeConfig";
import { KEYS } from "@/lib/settings";
import { parseLayout, widgetsByRegion, DEFAULT_LAYOUT, type Region } from "./layout";
import { WIDGETS } from "./registry";
import { ClockBlock } from "./ClockBlock";

const LEFT_REGIONS: Region[] = ["top-left", "left", "bottom-left"];
const RIGHT_REGIONS: Region[] = ["top-right", "right", "bottom-right"];

export function TimeCanvas() {
  const { value: layout } = useTimeSetting(KEYS.timeLayout, parseLayout, DEFAULT_LAYOUT);
  const byRegion = widgetsByRegion(layout);
  const cr = layout.clockRegion;

  const renderWidgets = (rs: Region[]) =>
    rs
      .flatMap((r) => byRegion[r])
      .map((p) => {
        const meta = WIDGETS[p.id];
        return meta ? (
          <div key={p.id} className="min-h-0">
            <meta.Component />
          </div>
        ) : null;
      });

  const showTop = cr === "top" || byRegion.top.length > 0;
  const showBottom = cr === "bottom" || byRegion.bottom.length > 0;
  const leftCol = renderWidgets(LEFT_REGIONS);
  const rightCol = renderWidgets(RIGHT_REGIONS);
  const centerWidgets = cr === "center" ? null : renderWidgets(["center"]);

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {showTop && (
        <div className="flex flex-col gap-1.5">
          {cr === "top" ? <ClockBlock /> : renderWidgets(["top"])}
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-stretch gap-3">
        {leftCol.length > 0 && (
          <div className="flex w-44 flex-col justify-center gap-1.5 overflow-hidden">
            {leftCol}
          </div>
        )}
        <div className="flex flex-1 items-center justify-center">
          {cr === "center" ? <ClockBlock /> : centerWidgets}
        </div>
        {rightCol.length > 0 && (
          <div className="flex w-44 flex-col justify-center gap-1.5 overflow-hidden">
            {rightCol}
          </div>
        )}
      </div>
      {showBottom && (
        <div className="flex flex-col gap-1.5">
          {cr === "bottom" ? <ClockBlock /> : renderWidgets(["bottom"])}
        </div>
      )}
    </div>
  );
}
