import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export interface MountedReactTree {
  root: Root;
  unmount: () => Promise<void>;
}

export async function mountReactTree(node: ReactNode): Promise<MountedReactTree> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(node);
  });

  return {
    root,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
