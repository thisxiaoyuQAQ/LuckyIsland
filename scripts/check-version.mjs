import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const options = {};
  for (let index = argv[0] === "--" ? 1 : 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

function packageVersion(cargoToml) {
  const packageStart = cargoToml.match(/^\[package\]\s*$/m);
  if (!packageStart) throw new Error("Cargo.toml is missing [package]");
  const afterPackage = cargoToml.slice(packageStart.index + packageStart[0].length);
  const packageBody = afterPackage.split(/^\[[^\]]+\]\s*$/m, 1)[0];
  const version = packageBody.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error("Cargo.toml [package] is missing an exact version");
  return version;
}

function normalizedTag(tag) {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

export async function checkVersions({ root = process.cwd(), tag }) {
  if (!tag) throw new Error("--tag is required");
  const [packageJson, cargoToml, tauriConfig] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(root, "src-tauri", "Cargo.toml"), "utf8"),
    readFile(resolve(root, "src-tauri", "tauri.conf.json"), "utf8").then(JSON.parse),
  ]);
  const versions = {
    package: String(packageJson.version ?? ""),
    cargo: packageVersion(cargoToml),
    tauri: String(tauriConfig.version ?? ""),
    tag: normalizedTag(tag),
  };
  if (new Set(Object.values(versions)).size !== 1 || !versions.package) {
    throw new Error(
      `version mismatch: package=${versions.package}, cargo=${versions.cargo}, tauri=${versions.tauri}, tag=${versions.tag}`,
    );
  }
  return { version: versions.package };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await checkVersions({ root: process.cwd(), tag: options.tag });
  console.log(`versions aligned: ${result.version}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
