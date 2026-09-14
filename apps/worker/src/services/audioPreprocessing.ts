/**
 * Preparación del audio para la transcripción (spec 016).
 *
 * El worker enviaba el fichero de vídeo entero a la API de ASR. La grabación real de 53,5 min pesaba
 * 375 MB y Groq respondió `413 request_too_large` en 1,6 s: cualquier reunión larga acababa en
 * `transcription_error` con el vídeo guardado y sin transcripción.
 *
 * Aquí se extrae la pista de audio y se comprime a opus mono 16 kHz. Medido sobre el caso real:
 * 375 MB → 8,95 MB, y Whisper lo transcribió en 14,6 s. Whisper trabaja internamente a 16 kHz, así
 * que no se pierde nada relevante.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  planTranscriptionInput,
  type AudioChunk,
} from "@/services/transcriptionInput";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/** Bitrate bajo el cual 2,3 horas de reunión caben en el límite de 25 MB. */
const AUDIO_BITRATE = "24k";
const AUDIO_SAMPLE_RATE = "16000";

export interface PreparedTranscriptionAudio {
  /** Ficheros de audio a transcribir, en orden. Uno solo si no hubo que trocear. */
  files: string[];
  /** Fragmentos que representan esos ficheros, para desplazar sus marcas de tiempo. */
  chunks: AudioChunk[];
  durationSeconds: number;
  /** Borra los temporales. Idempotente y seguro de llamar siempre. */
  cleanup: () => void;
}

export interface PrepareOptions {
  maxBytes?: number;
}

function runCommand(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`No se pudo ejecutar ${bin}: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${bin} salió con código ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}

/** Duración en segundos, o 0 si no se puede medir. Nunca lanza. */
export async function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { stdio: ["ignore", "pipe", "ignore"] });

    let stdout = "";
    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const parsed = Number.parseFloat(stdout.trim());
      resolve(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    });
  });
}

export async function prepareTranscriptionAudio(
  inputPath: string,
  options: PrepareOptions = {},
): Promise<PreparedTranscriptionAudio> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`No existe el fichero a transcribir: ${inputPath}`);
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-audio-"));
  const cleanup = () => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Un temporal que no se puede borrar no debe tumbar el pipeline.
    }
  };

  try {
    const durationSeconds = await probeDurationSeconds(inputPath);
    const extractedPath = path.join(workDir, "audio.ogg");

    await runCommand(FFMPEG, [
      "-v", "error",
      "-y",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", AUDIO_SAMPLE_RATE,
      "-c:a", "libopus",
      "-b:a", AUDIO_BITRATE,
      extractedPath,
    ]);

    const audioBytes = fs.statSync(extractedPath).size;
    const plan = planTranscriptionInput({ audioBytes, durationSeconds, maxBytes });

    console.log(
      `[audioPreprocessing] ${path.basename(inputPath)}: ${(audioBytes / 1048576).toFixed(2)} MB` +
      `${durationSeconds ? ` · ${durationSeconds.toFixed(0)}s` : ""}` +
      `${plan.needsChunking ? ` · troceado en ${plan.chunks.length} fragmentos` : ""}`,
    );

    if (!plan.needsChunking) {
      return { files: [extractedPath], chunks: plan.chunks, durationSeconds, cleanup };
    }

    const files: string[] = [];
    for (const chunk of plan.chunks) {
      const chunkPath = path.join(workDir, `audio-${String(chunk.index).padStart(3, "0")}.ogg`);
      await runCommand(FFMPEG, [
        "-v", "error",
        "-y",
        "-ss", String(chunk.startSeconds),
        "-t", String(chunk.durationSeconds),
        "-i", extractedPath,
        "-c", "copy",
        chunkPath,
      ]);
      files.push(chunkPath);
    }

    return { files, chunks: plan.chunks, durationSeconds, cleanup };
  } catch (error: unknown) {
    cleanup();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo preparar el audio para transcribir: ${message}`);
  }
}
