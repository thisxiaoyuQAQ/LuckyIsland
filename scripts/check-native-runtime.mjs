import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_NATIVE_DLLS = [
  "sherpa-onnx-c-api.dll",
  "sherpa-onnx-cxx-api.dll",
  "onnxruntime.dll",
  "onnxruntime_providers_shared.dll",
];

export async function checkNativeRuntime({
  root = process.cwd(),
  configPath = join(root, "src-tauri", "tauri.conf.json"),
} = {}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const resources = config?.bundle?.resources;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    throw new Error("bundle.resources must be an object mapping source paths to destinations");
  }

  const entries = Object.entries(resources);
  const destinations = new Set();
  for (const [, destination] of entries) {
    if (typeof destination !== "string") continue;
    if (destinations.has(destination)) {
      throw new Error(`duplicate bundle resource destination: ${destination}`);
    }
    destinations.add(destination);
  }

  for (const dll of REQUIRED_NATIVE_DLLS) {
    const mapping = entries.find(([, destination]) => destination === dll);
    if (!mapping) {
      throw new Error(`missing bundle resource mapping: ${dll}`);
    }

    const [source] = mapping;
    const sourcePath = resolve(dirname(configPath), source);
    let info;
    try {
      info = await stat(sourcePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`missing native runtime file: ${dll}`);
      }
      throw error;
    }
    if (!info.isFile()) {
      throw new Error(`native runtime path is not a file: ${dll}`);
    }
    if (info.size === 0) {
      throw new Error(`empty native runtime file: ${dll}`);
    }
  }

  return { checked: REQUIRED_NATIVE_DLLS.length };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkNativeRuntime()
    .then(({ checked }) => {
      console.log(`native runtime prerequisites ok: ${checked} DLLs`);
    })
    .catch((error) => {
      console.error(`native runtime prerequisite check failed: ${error.message}`);
      console.error("run the default-target release build before packaging");
      process.exitCode = 1;
    });
}
