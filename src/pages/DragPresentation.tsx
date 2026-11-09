import { Move } from "lucide-react";

export function DragPresentation() {
  return (
    <div data-drag-presentation className="flex h-full w-full items-center justify-center gap-2 whitespace-nowrap text-sm font-medium">
      <Move className="size-5" aria-hidden />
      <span>拖动调整位置</span>
    </div>
  );
}
