import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { checkVersions } from "../check-version.mjs";
import { validateUpdaterAssets } from "../validate-updater-assets.mjs";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lucky-release-"));
  tempDirs.push(root);
  return root;
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

async function versionFixture(overrides: Partial<Record<"package" | "cargo" | "tauri", string>> = {}) {
  const root = await tempRoot();
  await writeJson(join(root, "package.json"), { version: overrides.package ?? "0.2.1" });
  await mkdir(join(root, "src-tauri"), { recursive: true });
  await writeFile(
    join(root, "src-tauri", "Cargo.toml"),
    `[package]\nname = "lucky-island"\nversion = "${overrides.cargo ?? "0.2.1"}"\n\n[dependencies]\nserde = "1"\n`,
  );
  await writeJson(join(root, "src-tauri", "tauri.conf.json"), {
    version: overrides.tauri ?? "0.2.1",
  });
  return root;
}

async function assetFixture(options: {
  version?: string;
  tag?: string;
  host?: string;
  pathTag?: string;
  signature?: string;
  manifestFile?: string;
  repository?: string;
  omitExe?: boolean;
  omitSig?: boolean;
} = {}) {
  const root = await tempRoot();
  const version = options.version ?? "0.2.1";
  const tag = options.tag ?? "v0.2.1";
  const file = options.manifestFile ?? `LuckyIsland_${version}_x64-setup.exe`;
  if (!options.omitExe) await writeFile(join(root, file), "installer");
  if (!options.omitSig) await writeFile(join(root, `${file}.sig`), "local-signature");
  await writeJson(join(root, "latest.json"), {
    version,
    platforms: {
      "windows-x86_64": {
        url: `https://${options.host ?? "github.com"}/${options.repository ?? "thisxiaoyuQAQ/LuckyIsland"}/releases/download/${options.pathTag ?? tag}/${file}`,
        signature: options.signature ?? "manifest-signature",
      },
    },
  });
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("release version validation", () => {
  it("accepts matching package, Cargo, Tauri and tag versions", async () => {
    const root = await versionFixture();
    await expect(checkVersions({ root, tag: "v0.2.1" })).resolves.toEqual({ version: "0.2.1" });
  });

  it("reports all four values when any version differs", async () => {
    const root = await versionFixture({ cargo: "0.2.2", tauri: "0.3.0" });
    await expect(checkVersions({ root, tag: "v0.2.4" })).rejects.toThrow(
      "package=0.2.1, cargo=0.2.2, tauri=0.3.0, tag=0.2.4",
    );
  });

  it("strips exactly one leading v from the tag", async () => {
    const root = await versionFixture();
    await expect(checkVersions({ root, tag: "vv0.2.1" })).rejects.toThrow("tag=v0.2.1");
  });

  it("accepts pnpm's forwarded separator before CLI options", async () => {
    const root = await versionFixture();
    const script = join(process.cwd(), "scripts", "check-version.mjs");
    await expect(execFileAsync(process.execPath, [script, "--", "--tag", "v0.2.1"], { cwd: root }))
      .resolves.toMatchObject({ stdout: expect.stringContaining("versions aligned: 0.2.1") });
  });
});

describe("updater asset validation", () => {
  it("accepts a complete Windows NSIS updater asset set", async () => {
    const dir = await assetFixture();
    await expect(validateUpdaterAssets({ dir, version: "0.2.1", tag: "v0.2.1" })).resolves.toMatchObject({
      platform: "windows-x86_64",
    });
  });

  it.each([
    ["installer", { omitExe: true }, "missing NSIS installer"],
    ["signature file", { omitSig: true }, "missing updater signature file"],
    ["manifest signature", { signature: "" }, "empty manifest signature"],
  ])("rejects a missing %s", async (_label, fixtureOptions, message) => {
    const dir = await assetFixture(fixtureOptions);
    await expect(validateUpdaterAssets({ dir, version: "0.2.1", tag: "v0.2.1" })).rejects.toThrow(message);
  });

  it.each([
    ["wrong host", { host: "evil.example" }],
    ["wrong tag", { pathTag: "v9.9.9" }],
    ["latest alias", { pathTag: "latest" }],
    ["wrong repository", { repository: "other/Other" }],
  ])("rejects %s manifest URLs", async (_label, fixtureOptions) => {
    const dir = await assetFixture(fixtureOptions);
    await expect(validateUpdaterAssets({ dir, version: "0.2.1", tag: "v0.2.1" })).rejects.toThrow(
      "invalid updater URL",
    );
  });

  it("validates draft then published GitHub Release metadata and rejects prereleases", async () => {
    const dir = await assetFixture();
    const metadata = join(dir, "release.json");
    await writeJson(metadata, { tag_name: "v0.2.1", draft: true, prerelease: false });
    await expect(
      validateUpdaterAssets({ dir, version: "0.2.1", tag: "v0.2.1", releaseMetadata: metadata, expectedDraft: true }),
    ).resolves.toBeDefined();
    await expect(
      validateUpdaterAssets({ dir, version: "0.2.1", tag: "v0.2.1", releaseMetadata: metadata, expectedDraft: false }),
    ).rejects.toThrow("release draft state mismatch");

    await writeJson(metadata, { tag_name: "v0.2.1", draft: false, prerelease: true });
    await expect(
      validateUpdaterAssets({ dir, version: "0.2.1", tag: "v0.2.1", releaseMetadata: metadata, expectedDraft: false }),
    ).rejects.toThrow("prerelease releases are forbidden");
  });

  it("does not include signature contents in validation errors", async () => {
    const secret = "SUPER-SECRET-SIGNATURE-CONTENT";
    const dir = await assetFixture({ signature: secret, pathTag: "wrong" });
    try {
      await validateUpdaterAssets({ dir, version: "0.2.1", tag: "v0.2.1" });
      throw new Error("expected validation failure");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
