import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REQUIRED_NATIVE_DLLS, checkNativeRuntime } from "./check-native-runtime.mjs";

const tempDirs = [];

async function fixture({ omittedMapping, missingFile, emptyFile } = {}) {
  const root = await mkdtemp(join(tmpdir(), "lucky-native-runtime-"));
  tempDirs.push(root);
  const resources = {};

  for (const dll of REQUIRED_NATIVE_DLLS) {
    if (dll === omittedMapping) continue;
    const source = `target/release/${dll}`;
    resources[source] = dll;
    if (dll === missingFile) continue;
    const absolute = join(root, "src-tauri", source);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, dll === emptyFile ? "" : `fixture:${dll}`);
  }

  const configPath = join(root, "src-tauri", "tauri.conf.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ bundle: { resources } }));
  return { root, configPath };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("native runtime bundle prerequisites", () => {
  it("accepts a complete non-empty DLL resource mapping", async () => {
    const { root, configPath } = await fixture();

    await expect(checkNativeRuntime({ root, configPath })).resolves.toEqual({
      checked: REQUIRED_NATIVE_DLLS.length,
    });
  });

  it("rejects a mapped DLL whose source file is missing", async () => {
    const missing = REQUIRED_NATIVE_DLLS[0];
    const { root, configPath } = await fixture({ missingFile: missing });

    await expect(checkNativeRuntime({ root, configPath })).rejects.toThrow(
      `missing native runtime file: ${missing}`,
    );
  });

  it("rejects an empty DLL source file", async () => {
    const empty = REQUIRED_NATIVE_DLLS[1];
    const { root, configPath } = await fixture({ emptyFile: empty });

    await expect(checkNativeRuntime({ root, configPath })).rejects.toThrow(
      `empty native runtime file: ${empty}`,
    );
  });

  it("rejects a required DLL omitted from the bundle mapping", async () => {
    const omitted = REQUIRED_NATIVE_DLLS[2];
    const { root, configPath } = await fixture({ omittedMapping: omitted });

    await expect(checkNativeRuntime({ root, configPath })).rejects.toThrow(
      `missing bundle resource mapping: ${omitted}`,
    );
  });
});
