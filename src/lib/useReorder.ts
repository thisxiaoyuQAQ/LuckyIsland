import { useRef, useState, type DragEvent } from "react";

/**
 * 列表拖拽排序（原生 HTML5 DnD，鼠标够用）。
 * 用法：const { overIndex, itemProps } = useReorder(onReorder);
 *      <li {...itemProps(i, items)} />
 * onReorder 收到重排后的新数组，由调用方负责 setState + 持久化。
 */
export function useReorder<T>(onReorder: (next: T[]) => void) {
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const itemProps = (i: number, items: T[]) => ({
    draggable: true,
    onDragStart: () => {
      dragIndex.current = i;
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOverIndex(i);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const from = dragIndex.current;
      dragIndex.current = null;
      setOverIndex(null);
      if (from === null || from === i) return;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(i, 0, moved);
      onReorder(next);
    },
    onDragEnd: () => {
      dragIndex.current = null;
      setOverIndex(null);
    },
  });

  return { overIndex, itemProps };
}
