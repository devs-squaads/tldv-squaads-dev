#!/usr/bin/env bun
/**
 * refineDictionary.ts — Auto-refinamiento del diccionario de transcripción.
 *
 * Port de refine_dictionary.py (clean_transcriptions) al pipeline del bot:
 * revisa los candidatos acumulados (raw vs clean de cada reunión) y permite
 * promoverlos al diccionario de correcciones.
 *
 * Uso:
 *   bun run dictionary:refine                 # Reporte de candidatos acumulados
 *   bun run dictionary:refine --commit        # Promueve los top 20 al diccionario
 *   bun run dictionary:refine --output out.md # Guarda el reporte en fichero
 *   bun run dictionary:refine --raw raw.md --clean clean.md  # Modo ficheros (análisis puntual)
 *
 * Ideal para cron semanal: reporte sin commit; el commit es siempre manual.
 */
import fs from "fs";
import {
  clearDictionaryCandidates,
  loadDictionaryCandidates,
} from "@/repositories/DictionaryCandidateRepository";
import {
  getTranscriptionSettings,
  saveTranscriptionSettings,
  parseDictionaryPairs,
} from "@meeting-bot/shared/services/transcriptionSettings";
import {
  analyzeRawVsClean,
  type DictionaryPair,
} from "@meeting-bot/shared/services/dictionaryRefinement";

const COMMIT_LIMIT = 20;

interface CliArgs {
  commit: boolean;
  output: string | null;
  raw: string | null;
  clean: string | null;
  dict: string | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { commit: false, output: null, raw: null, clean: null, dict: null, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--commit":
        args.commit = true;
        break;
      case "--output":
        args.output = argv[i + 1] || null;
        i += 1;
        break;
      case "--raw":
        args.raw = argv[i + 1] || null;
        i += 1;
        break;
      case "--clean":
        args.clean = argv[i + 1] || null;
        i += 1;
        break;
      case "--dict":
        args.dict = argv[i + 1] || null;
        i += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        break;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`Refinamiento del diccionario de transcripción

Uso:
  bun run dictionary:refine                 Reporte de candidatos acumulados
  bun run dictionary:refine --commit        Promueve los top ${COMMIT_LIMIT} candidatos al diccionario
  bun run dictionary:refine --output out.md Guarda el reporte en fichero
  bun run dictionary:refine --raw a.md --clean b.md            Análisis puntual por ficheros
  bun run dictionary:refine --raw a.md --clean b.md --dict d.md  Ídem + pares existentes desde fichero

Los candidatos se acumulan automáticamente tras cada reunión (raw vs clean).
El commit es manual a propósito: revisa el reporte antes de promover.`);
}

function renderCandidatesTable(
  rows: Array<{ wrong: string; correct: string; hits: number }>,
): string {
  if (!rows.length) {
    return "No hay candidatos acumulados todavía.";
  }
  const lines = ["| Errónea | Corrección | Hits |", "|---|---|---|"];
  for (const row of rows) {
    lines.push(`| \`${row.wrong}\` | \`${row.correct}\` | ${row.hits} |`);
  }
  return lines.join("\n");
}

async function runDbMode(args: CliArgs): Promise<void> {
  const candidates = await loadDictionaryCandidates();

  const report = [
    "# 🔍 Reporte de Refinamiento del Diccionario",
    `Generado: ${new Date().toISOString()}`,
    "",
    "## Candidatos acumulados (raw vs clean de reuniones procesadas)",
    "",
    renderCandidatesTable(candidates),
    "",
    `*Total: ${candidates.length}*`,
    "",
    args.commit ? "Promoviendo al diccionario…" : `Usa \`--commit\` para promover los top ${COMMIT_LIMIT} al diccionario.`,
    "",
  ].join("\n");

  if (args.output) {
    fs.writeFileSync(args.output, report);
    console.log(`✅ Reporte guardado: ${args.output}`);
  } else {
    console.log(report);
  }

  if (!args.commit || !candidates.length) {
    return;
  }

  const toPromote = candidates.slice(0, COMMIT_LIMIT);
  const settings = await getTranscriptionSettings();

  const existingRaw = settings.dictionary.trim();
  const newLines = toPromote.map((c) => `"${c.wrong}" => "${c.correct}"`);
  const dictionary = existingRaw ? `${existingRaw}\n${newLines.join("\n")}` : newLines.join("\n");

  await saveTranscriptionSettings({ dictionary });
  await clearDictionaryCandidates();

  console.log(`\n✅ ${toPromote.length} correcciones añadidas al diccionario.`);
  for (const c of toPromote) {
    console.log(`   "${c.wrong}" => "${c.correct}"`);
  }
  console.log("Candidatos limpiados.");
}

async function runFileMode(args: CliArgs): Promise<void> {
  if (!args.raw || !args.clean) {
    console.error("Modo ficheros requiere --raw <fichero> y --clean <fichero>");
    process.exit(1);
  }

  if (!fs.existsSync(args.raw) || !fs.existsSync(args.clean)) {
    console.error(`No existe el fichero raw (${args.raw}) o clean (${args.clean}).`);
    process.exit(1);
  }

  const raw = fs.readFileSync(args.raw, "utf-8");
  const clean = fs.readFileSync(args.clean, "utf-8");

  // Pares existentes: opcional, desde un fichero de diccionario (sin tocar DB).
  let existingPairs: DictionaryPair[] = [];
  if (args.dict) {
    if (!fs.existsSync(args.dict)) {
      console.error(`No existe el fichero de diccionario (${args.dict}).`);
      process.exit(1);
    }
    existingPairs = parseDictionaryPairs(fs.readFileSync(args.dict, "utf-8"));
  }

  const suggestions = analyzeRawVsClean(raw, clean, existingPairs);
  const pairs = suggestions.filter((s) => s.correct);

  const report = [
    "# 🔍 Análisis puntual raw vs clean",
    `Fichero raw: ${args.raw}`,
    `Fichero clean: ${args.clean}`,
    "",
    "## Sugerencias de corrección",
    "",
    pairs.length
      ? ["| Errónea | Corrección | Ocurrencias raw | Score |", "|---|---|---|---|"]
        .concat(
          pairs.map(
            (s) => `| \`${s.wrong}\` | \`${s.correct}\` | ${s.rawCount} | ${s.score} |`,
          ),
        )
        .join("\n")
      : "No se detectaron patrones de corrección con suficiente confianza.",
    "",
  ].join("\n");

  if (args.output) {
    fs.writeFileSync(args.output, report);
    console.log(`✅ Reporte guardado: ${args.output}`);
  } else {
    console.log(report);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.raw || args.clean) {
    await runFileMode(args);
    return;
  }

  await runDbMode(args);
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌ Error: ${message}`);
  process.exit(1);
});
