import { REGION_LABELS, type Region } from "./layout";
import { cn } from "@/lib/utils";

const GRID: Region[][] = [
  ["top-left", "top", "top-right"],
  ["left", "center", "right"],
  ["bottom-left", "bottom", "bottom-right"],
];

/** 3×3 区域选择器：value 为当前选中区域，disabled 为不可选（如组件不能选时钟区域）。 */
export function RegionPicker({
  value,
  onPick,
  disabled = [],
}: {
  value: Region;
  onPick: (r: Region) => void;
  disabled?: Region[];
}) {
  return (
    <div className="grid w-40 grid-cols-3 grid-rows-3 gap-1">
      {GRID.flat().map((r) => {
        const off = disabled.includes(r);
        return (
          <button
            key={r}
            type="button"
            disabled={off}
            onClick={() => onPick(r)}
            aria-label={REGION_LABELS[r]}
            className={cn(
              "h-9 rounded-md border text-xs transition-colors",
              off
                ? "cursor-not-allowed border-border/40 bg-transparent text-muted-foreground/40"
                : r === value
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-accent",
            )}
          >
            {REGION_LABELS[r]}
          </button>
        );
      })}
    </div>
  );
}
