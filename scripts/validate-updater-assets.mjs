import { access, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = "windows-x86_64";
const REPOSITORY_PREFIX = "/thisxiaoyuQAQ/LuckyIsland/releases/download/";

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

async function requireNonEmptyFile(path, message) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error(message);
  } catch (error) {
    if (error instanceof Error && error.message === message) throw error;
    throw new Error(message);
  }
}

function validatedAssetUrl(value, tag) {
  if (typeof value !== "string") throw new Error("invalid updater URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid updater URL");
  }
  const expectedPrefix = `${REPOSITORY_PREFIX}${tag}/`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !url.pathname.startsWith(expectedPrefix)) {
    throw new Error("invalid updater URL");
  }
  const filename = basename(url.pathname);
  if (!filename || !filename.toLowerCase().endsWith(".exe")) throw new Error("invalid updater URL");
  return { url: url.toString(), filename };
}

async function validateReleaseMetadata(path, tag, expectedDraft) {
  if (typeof expectedDraft !== "boolean") {
    throw new Error("--expected-draft is required with --release-metadata");
  }
  const metadata = JSON.parse(await readFile(path, "utf8"));
  if (metadata.tag_name !== tag) throw new Error("release tag mismatch");
  if (metadata.prerelease !== false) throw new Error("prerelease releases are forbidden");
  if (metadata.draft !== expectedDraft) throw new Error("release draft state mismatch");
}

export async function validateUpdaterAssets({
  dir,
  version,
  tag,
  releaseMetadata,
  expectedDraft,
}) {
  if (!dir || !version || !tag) throw new Error("--dir, --version and --tag are required");
  const manifestPath = resolve(dir, "latest.json");
  await access(manifestPath).catch(() => {
    throw new Error("missing latest.json");
  });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== version) throw new Error("updater manifest version mismatch");
  const platform = manifest.platforms?.[PLATFORM];
  if (!platform) throw new Error(`missing updater platform: ${PLATFORM}`);
  if (typeof platform.signature !== "string" || platform.signature.trim() === "") {
    throw new Error("empty manifest signature");
  }
  const asset = validatedAssetUrl(platform.url, tag);
  const installer = resolve(dir, asset.filename);
  await requireNonEmptyFile(installer, "missing NSIS installer");
  await requireNonEmptyFile(`${installer}.sig`, "missing updater signature file");

  if (releaseMetadata) {
    await validateReleaseMetadata(releaseMetadata, tag, expectedDraft);
  } else if (expectedDraft !== undefined) {
    throw new Error("--expected-draft requires --release-metadata");
  }

  return { platform: PLATFORM, installer: asset.filename, url: asset.url };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const expectedDraft = options["expected-draft"] === undefined
    ? undefined
    : options["expected-draft"] === "true"
      ? true
      : options["expected-draft"] === "false"
        ? false
        : (() => { throw new Error("--expected-draft must be true or false"); })();
  const result = await validateUpdaterAssets({
    dir: options.dir,
    version: options.version,
    tag: options.tag,
    releaseMetadata: options["release-metadata"],
    expectedDraft,
  });
  console.log(`updater assets valid: ${result.platform} ${result.installer}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
