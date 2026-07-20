import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const extensionDir = import.meta.dir;
const distDir = join(extensionDir, "dist");
const internalDownloadsDir = join(extensionDir, "..", "web", "private-downloads");
const internalZipName = "squaads-extension-internal.zip";
const internalZipPath = join(internalDownloadsDir, internalZipName);

const entries = [
  {
    entrypoint: join(extensionDir, "src", "background", "service-worker.ts"),
    outdir: join(distDir, "background"),
  },
  {
    entrypoint: join(extensionDir, "src", "content", "content.ts"),
    outdir: join(distDir, "content"),
  },
  {
    entrypoint: join(extensionDir, "src", "popup", "popup.ts"),
    outdir: join(distDir, "popup"),
  },
];

async function buildEntrypoint(entrypoint: string, outdir: string) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir,
    target: "browser",
    format: "esm",
    naming: "[name].js",
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }

    throw new Error(`Extension build failed for ${entrypoint}`);
  }
}

async function buildInternalZip() {
  await mkdir(internalDownloadsDir, { recursive: true });
  await rm(internalZipPath, { force: true });

  const isWindows = process.platform === "win32";
  let exitCode: number;

  if (isWindows) {
    // PowerShell Compress-Archive is available on all modern Windows.
    // Single quotes protect paths with spaces; wildcard includes dist contents at ZIP root.
    const proc = Bun.spawn({
      cmd: [
        "powershell",
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${join(distDir, "*")}' -DestinationPath '${internalZipPath}' -Force`,
      ],
      stdout: "inherit",
      stderr: "inherit",
    });
    exitCode = await proc.exited;
  } else {
    // Linux/macOS: use the zip utility (also used by CI).
    const proc = Bun.spawn({
      cmd: ["zip", "-r", internalZipPath, "."],
      cwd: distDir,
      stdout: "inherit",
      stderr: "inherit",
    });
    exitCode = await proc.exited;
  }

  if (exitCode !== 0) {
    throw new Error(`Internal extension ZIP build failed with exit code ${exitCode}`);
  }
}

async function main() {
  console.log("Building extension...");

  await rm(distDir, { recursive: true, force: true });
  await mkdir(join(distDir, "background"), { recursive: true });
  await mkdir(join(distDir, "content"), { recursive: true });
  await mkdir(join(distDir, "popup"), { recursive: true });
  await mkdir(join(distDir, "assets"), { recursive: true });

  for (const entry of entries) {
    await buildEntrypoint(entry.entrypoint, entry.outdir);
  }

  await cp(join(extensionDir, "manifest.json"), join(distDir, "manifest.json"));
  await cp(join(extensionDir, "src", "popup", "popup.html"), join(distDir, "popup", "popup.html"));
  await cp(join(extensionDir, "src", "popup", "popup.css"), join(distDir, "popup", "popup.css"));
  await cp(join(extensionDir, "assets", "squaads-icon.png"), join(distDir, "assets", "squaads-icon.png"));
  await buildInternalZip();

  console.log("Build complete: apps/extension/dist");
  console.log(`Internal package ready: apps/web/private-downloads/${internalZipName}`);
}

await main();
