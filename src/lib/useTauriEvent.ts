import { useLayoutEffect, useRef } from "react";
import { listen, type Event } from "@tauri-apps/api/event";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";

export interface TauriEventOptions {
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export function useTauriEvent<T>(
  eventName: string,
  handler: (event: Event<T>) => void,
  options: TauriEventOptions = {},
): void {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  const enabled = options.enabled ?? true;

  useAsyncSubscription(
    (isActive) => {
      if (!enabled) return Promise.resolve(() => undefined);
      return listen<T>(eventName, (incoming) => {
        if (isActive()) handlerRef.current(incoming);
      });
    },
    [eventName, enabled],
    { label: `listen:${eventName}`, onError: options.onError },
  );
}
