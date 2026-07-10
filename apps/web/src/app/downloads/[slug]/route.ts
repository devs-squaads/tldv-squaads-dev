import { readFile } from "node:fs/promises";
import { join } from "node:path";

const INTERNAL_EXTENSION_PACKAGE = "squaads-extension-internal.zip";
const ZIP_PATH_CANDIDATES = [
  join(process.cwd(), "private-downloads", INTERNAL_EXTENSION_PACKAGE),
  join(process.cwd(), "apps", "web", "private-downloads", INTERNAL_EXTENSION_PACKAGE),
];

async function readInternalExtensionZip() {
  for (const zipPath of ZIP_PATH_CANDIDATES) {
    try {
      return await readFile(zipPath);
    } catch {
      continue;
    }
  }

  throw new Error("Internal extension package not available");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  if (slug !== INTERNAL_EXTENSION_PACKAGE) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readInternalExtensionZip();

    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${INTERNAL_EXTENSION_PACKAGE}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response(
      "Internal extension package not available yet. Place apps/web/private-downloads/squaads-extension-internal.zip on the server before sharing this link.",
      {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
