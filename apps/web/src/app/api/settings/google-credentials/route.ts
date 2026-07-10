import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const CREDENTIALS_PATH = path.join(process.cwd(), "resources", "google_service_account_file.json");

export async function GET() {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      return NextResponse.json({ exists: false, content: null });
    }
    const content = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    // Return only non-sensitive fields for display
    try {
      const parsed = JSON.parse(content);
      return NextResponse.json({
        exists: true,
        preview: {
          type: parsed.type || "",
          project_id: parsed.project_id || "",
          client_email: parsed.client_email || "",
          client_id: parsed.client_id || "",
        },
      });
    } catch {
      return NextResponse.json({ exists: true, preview: null });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { json } = (await req.json()) as { json: string };

    if (!json || typeof json !== "string") {
      return NextResponse.json({ error: "JSON content is required" }, { status: 400 });
    }

    // Validate it's valid JSON and has expected fields
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json);
    } catch {
      return NextResponse.json({ error: "JSON inválido. Verifica el formato." }, { status: 400 });
    }

    if (!parsed.type || !parsed.project_id || !parsed.private_key) {
      return NextResponse.json({
        error: "El JSON no parece ser un Service Account válido. Debe contener 'type', 'project_id' y 'private_key'.",
      }, { status: 400 });
    }

    // Ensure resources directory exists
    const dir = path.dirname(CREDENTIALS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write formatted JSON
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(parsed, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      preview: {
        type: parsed.type,
        project_id: parsed.project_id,
        client_email: parsed.client_email || "",
        client_id: parsed.client_id || "",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      fs.unlinkSync(CREDENTIALS_PATH);
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
