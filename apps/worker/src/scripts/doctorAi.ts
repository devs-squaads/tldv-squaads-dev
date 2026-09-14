/**
 * Comprobación de salud del pipeline de IA (spec 016).
 *
 * Existe porque el 2026-09-14 tres de las cuatro etapas estaban caídas y nadie lo sabía: el diseño
 * degrada en silencio («nunca rompas el pipeline»), así que un modelo retirado o una cuota agotada
 * se manifiestan como un transcript sin hablantes y sin resumen, no como un error.
 *
 * Hace llamadas REALES y mínimas. Sale con código 1 si alguna etapa falla.
 *
 *   bun run doctor:ai
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { getAiModels, resolveAiModels } from "@/services/aiModels";
import { TextGenerationProviderFactory } from "@/integrations/ai/text/TextGenerationProviderFactory";
import { transcribeRecording } from "@/services/meetingAiProcessingService";
import { refineTranscript } from "@/services/gemini";
import { SummaryProviderFactory } from "@/integrations/ai/summary/SummaryProviderFactory";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const SAMPLE_TRANSCRIPT = [
  "[00:00] Buenos días, empezamos la reunión de seguimiento.",
  "[00:05] Vale, quería comentar el presupuesto de Squaads para el próximo trimestre.",
].join("\n");

interface StageResult {
  stage: string;
  ok: boolean;
  detail: string;
}

function makeSilence(seconds: number): Promise<string> {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "doctor-ai-")), "silence.ogg");
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, [
      "-v", "error",
      "-y",
      "-f", "lavfi",
      "-i", `anullsrc=r=16000:cl=mono`,
      "-t", String(seconds),
      "-c:a", "libopus",
      "-b:a", "24k",
      target,
    ], { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (e) => reject(new Error(`ffmpeg no disponible: ${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve(target) : reject(new Error(`ffmpeg falló (${code}): ${stderr.slice(0, 200)}`)),
    );
  });
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

async function checkAsr(): Promise<StageResult> {
  const stage = "transcripción (ASR)";
  let silencePath: string | null = null;

  try {
    silencePath = await makeSilence(3);
    const result = await transcribeRecording(silencePath);
    return {
      stage,
      ok: true,
      detail: `aceptó el audio (${getAiModels().geminiModel}, ${result.segments.length} segmentos)`,
    };
  } catch (error: unknown) {
    return { stage, ok: false, detail: describe(error) };
  } finally {
    if (silencePath) {
      try { fs.rmSync(path.dirname(silencePath), { recursive: true, force: true }); } catch { /* temporal */ }
    }
  }
}

async function checkTextModel(): Promise<StageResult> {
  const stage = "modelo de texto";
  const provider = TextGenerationProviderFactory.getProvider();

  try {
    const result = await TextGenerationProviderFactory.generate({
      user: "Responde solo con la palabra OK",
      temperature: 0,
      reasoning: "off",
    });

    return {
      stage,
      ok: Boolean(result.text),
      detail: result.text
        ? `${result.provider}/${result.model} respondió con "${result.text.slice(0, 20)}"`
        : `${result.provider} respondió vacío`,
    };
  } catch (error: unknown) {
    return { stage, ok: false, detail: `${provider.name}: ${describe(error)}` };
  }
}

async function checkRefiner(): Promise<StageResult> {
  const stage = "refiner (diccionario/contexto)";
  try {
    const refined = await refineTranscript(SAMPLE_TRANSCRIPT, "Reunión interna de Squaads");
    return {
      stage,
      ok: refined.trim().length > 0,
      detail: `reemitió ${refined.length} caracteres`,
    };
  } catch (error: unknown) {
    return { stage, ok: false, detail: describe(error) };
  }
}

async function checkSummary(): Promise<StageResult> {
  const stage = "resumen";
  try {
    if (!SummaryProviderFactory.isConfigured()) {
      return { stage, ok: false, detail: "no hay proveedor de resumen configurado" };
    }
    const summary = await SummaryProviderFactory.getProvider().summarize(SAMPLE_TRANSCRIPT, {
      context: "Reunión interna",
    });
    return {
      stage,
      ok: Boolean(summary.summary?.trim()),
      detail: `devolvió un resumen de ${summary.summary?.length ?? 0} caracteres`,
    };
  } catch (error: unknown) {
    return { stage, ok: false, detail: describe(error) };
  }
}

async function main() {
  const { models, warnings } = resolveAiModels();

  console.log("doctor:ai · comprobación del pipeline de IA\n");
  console.log(`  audio      ${models.geminiModel}   (transcribe y diariza)`);
  console.log(`  texto      ${models.deepseekModel}   (refiner y resumen)`);
  console.log(
    `  claves     DEEPSEEK=${Boolean(process.env.DEEPSEEK_API_KEY)} GEMINI=${Boolean(process.env.GEMINI_API_KEY)}`,
  );
  for (const warning of warnings) {
    console.log(`  AVISO      ${warning}`);
  }
  console.log("");

  const results: StageResult[] = [];
  for (const check of [checkAsr, checkTextModel, checkRefiner, checkSummary]) {
    const result = await check();
    results.push(result);
    console.log(`  ${result.ok ? "OK  " : "FALLA"}  ${result.stage.padEnd(30)} ${result.detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length === 0) {
    console.log("Todas las etapas responden.");
    return;
  }

  console.log(`${failed.length} de ${results.length} etapas caídas: ${failed.map((f) => f.stage).join(", ")}`);
  process.exitCode = 1;
}

void main();
