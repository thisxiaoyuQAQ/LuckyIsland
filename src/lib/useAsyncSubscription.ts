import { useEffect, useLayoutEffect, useRef, type DependencyList } from "react";

export type Dispose = () => void;

export interface AsyncSubscriptionOptions {
  label: string;
  onError?: (error: unknown) => void;
}

export function useAsyncSubscription(
  subscribe: () => Promise<Dispose>,
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

    try {
      void subscribeRef.current().then(
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
