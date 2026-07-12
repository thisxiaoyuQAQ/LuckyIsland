import type { ReactNode } from "react";

/** 设置面板各子面板复用的表单行：左 label+desc，右控件 */
export function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex flex-col gap-0.5">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-xs text-muted-foreground">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export const selectCls =
  "rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50";
