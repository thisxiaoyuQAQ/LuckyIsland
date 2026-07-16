import { useEffect, useLayoutEffect, useRef, type DependencyList } from "react";

export type Dispose = () => void;
export type IsSubscriptionActive = () => boolean;

export interface AsyncSubscriptionOptions {
  label: string;
  onError?: (error: unknown) => void;
}

export function useAsyncSubscription(
  subscribe: (isActive: IsSubscriptionActive) => Promise<Dispose>,
  deps: DependencyList,
  options: AsyncSubscriptionOptions,
): void {
  const subscribeRef = useRef(subscribe);
  useLayoutEffect(() => {
    subscribeRef.current = subscribe;
  }, [subscribe]);

  useEffect(() => {
    const currentOptions = options;
    let disposed = false;
    let currentDispose: Dispose | undefined;

    const reportError = (error: unknown) => {
      if (currentOptions.onError) {
        currentOptions.onError(error);
        return;
      }
      console.error(`[async-subscription] ${currentOptions.label}`, error);
    };

    const dispose = (candidate: Dispose) => {
      try {
        candidate();
      } catch (error) {
        reportError(error);
      }
    };

    const isActive: IsSubscriptionActive = () => !disposed;

    try {
      void subscribeRef.current(isActive).then(
        (candidate) => {
          if (disposed) {
            dispose(candidate);
            return;
          }
          currentDispose = candidate;
        },
        (error: unknown) => {
          reportError(error);
        },
      );
    } catch (error) {
      reportError(error);
    }

    return () => {
      disposed = true;
      const candidate = currentDispose;
      currentDispose = undefined;
      if (candidate) dispose(candidate);
    };
  }, deps);
}
