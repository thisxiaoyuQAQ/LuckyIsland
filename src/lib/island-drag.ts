export interface PhysicalPoint {
  x: number;
  y: number;
}

export interface PhysicalSize {
  width: number;
  height: number;
}

export interface PhysicalMonitor {
  position: PhysicalPoint;
  size: PhysicalSize;
}

/**
 * 把拖动后的窗口物理坐标反算成现有顶部居中基准的物理偏移。
 * 偏移契约仍由后端 window_offset_apply 负责 clamp、落盘和上屏。
 */
export function offsetFromWindowPosition(
  monitor: PhysicalMonitor,
  windowPosition: PhysicalPoint,
  windowSize: PhysicalSize,
  topGap: number,
): [number, number] {
  const baseX =
    monitor.position.x + (monitor.size.width - windowSize.width) / 2;
  const baseY = monitor.position.y + topGap;
  return [
    Math.round(windowPosition.x - baseX),
    Math.round(windowPosition.y - baseY),
  ];
}
