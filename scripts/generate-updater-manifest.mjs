import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const options = {};
  for (let index = argv[0] === "--" ? 1 : 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`invalid argument near ${key ?? "end"}`);
    }
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

export function createUpdaterManifest({ version, tag, filename, signature }) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    throw new Error("invalid version");
  }
  if (tag !== `v${version}`) throw new Error("tag must match v<version>");
  if (!filename || filename !== basename(filename) || !filename.toLowerCase().endsWith(".exe")) {
    throw new Error("invalid installer filename");
  }
  if (typeof signature !== "string" || signature.trim() === "") {
    throw new Error("signature is required");
  }
  return {
    version,
    platforms: {
      "windows-x86_64": {
        url: `https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/download/${tag}/${filename}`,
        signature: signature.trim(),
      },
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const signature = await readFile(options["signature-file"], "utf8");
  const manifest = createUpdaterManifest({
    version: options.version,
    tag: options.tag,
    filename: options.filename,
    signature,
  });
  await writeFile(options.output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`updater manifest written: ${options.output}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
