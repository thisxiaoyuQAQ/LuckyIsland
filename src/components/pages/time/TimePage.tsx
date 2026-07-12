import { ClockBlock } from "./ClockBlock";
import { TimeCanvas } from "./TimeCanvas";

export function TimePage({ compact }: { compact: boolean }) {
  if (compact) return <ClockBlock compact />;
  return <TimeCanvas />;
}
