/**
 * mercury Multilingual Token Reduction Benchmark
 *
 * Measures token reduction across 9 languages + English (sanity check)
 * using the Anthropic token counting API.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx benchmarks/multilingual.ts
 *   ANTHROPIC_AUTH_TOKEN=... npx tsx benchmarks/multilingual.ts
 *   npx tsx benchmarks/multilingual.ts --regenerate   # rebuild sample cache
 */

import { config as dotenvConfig } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import translate from "google-translate-api-x";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

dotenvConfig();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_PATH = join(__dirname, "samples.json");

const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
const authToken = process.env.ANTHROPIC_AUTH_TOKEN ?? "";

if (!apiKey && !authToken) {
  console.error("Error: Either ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required");
  process.exit(1);
}

const client = new Anthropic({
  apiKey: apiKey || null,
  authToken: authToken || null,
  defaultHeaders: authToken
    ? { "anthropic-beta": "oauth-2025-04-20" }
    : undefined,
});

const MODEL = "claude-sonnet-4-20250514";

// Model pricing per 1M input tokens (USD)
const MODEL_PRICING: { name: string; inputPrice: number }[] = [
  { name: "Haiku 4.5", inputPrice: 0.80 },
  { name: "Sonnet 4.6", inputPrice: 3.00 },
  { name: "Opus 4.5", inputPrice: 15.00 },
];

// ── Target languages ──

interface Language {
  code: string;
  name: string;
  script: string;
}

const LANGUAGES: Language[] = [
  { code: "ja", name: "Japanese", script: "CJK + Kana" },
  { code: "zh-CN", name: "Chinese (Simplified)", script: "CJK" },
  { code: "ko", name: "Korean", script: "Hangul" },
  { code: "ar", name: "Arabic", script: "Arabic" },
  { code: "hi", name: "Hindi", script: "Devanagari" },
  { code: "ru", name: "Russian", script: "Cyrillic" },
  { code: "de", name: "German", script: "Latin" },
  { code: "fr", name: "French", script: "Latin" },
  { code: "es", name: "Spanish", script: "Latin" },
  { code: "en", name: "English", script: "Latin" },
];

// ── English source texts ──

const ENGLISH_SAMPLES = [
  {
    label: "Short (~30 tok)",
    text: "Please improve the error handling in this file. I want to display user-friendly messages when exceptions occur.",
  },
  {
    label: "Medium (~80 tok)",
    text: "We are experiencing database connection timeout issues in production. Please check the connection pool settings and adjust to optimal values. Also, please add retry logic. After checking the error logs, the issues appear to be concentrated during peak hours (9 AM to 11 AM).",
  },
  {
    label: "Long (~170 tok)",
    text: "We are considering migrating to a microservices architecture. We want to split the current monolithic application into four services: user management, order processing, inventory management, and notification service. We plan to use message queues for inter-service communication and route requests through an API gateway. We are also considering adopting the Saga pattern to maintain data consistency. First, could you give your opinion on this design approach, and then create a phased migration plan?",
  },
];

// ── Sample cache ──

interface SamplesCache {
  generatedAt: string;
  // lang code → sample index → translated text (EN → lang)
  translations: Record<string, string[]>;
  // lang code → sample index → back-translated English text
  toEnglish?: {
    google: Record<string, string[]>;
    haiku: Record<string, string[]>;
  };
}

async function translateWithHaiku(text: string, from: string, to: string): Promise<string> {
  const fromLabel = from === "auto" ? "the source language" : from;
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Translate the following text from ${fromLabel} to ${to}. Output ONLY the translated text, nothing else. Do not add explanations, notes, or formatting.\n\n${text}`,
      },
    ],
  });
  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error(`Unexpected response type: ${block.type}`);
  }
  return block.text;
}

async function generateSamples(): Promise<SamplesCache> {
  console.log("Generating translated samples...");
  const translations: Record<string, string[]> = {};
  const toEnglishGoogle: Record<string, string[]> = {};
  const toEnglishHaiku: Record<string, string[]> = {};

  // Step 1: EN → each language (via Google Translate)
  console.log("\n[1/3] Translating English → each language (Google Translate)");
  for (const lang of LANGUAGES) {
    if (lang.code === "en") {
      translations["en"] = ENGLISH_SAMPLES.map((s) => s.text);
      continue;
    }

    process.stdout.write(`  ${lang.name} (${lang.code})...`);
    const texts: string[] = [];
    for (const sample of ENGLISH_SAMPLES) {
      const result = await translate(sample.text, { from: "en", to: lang.code });
      texts.push(result.text);
    }
    translations[lang.code] = texts;
    console.log(" done");
  }

  // Step 2: each language → EN (via Google Translate)
  console.log("\n[2/3] Back-translating to English (Google Translate)");
  for (const lang of LANGUAGES) {
    if (lang.code === "en") {
      toEnglishGoogle["en"] = ENGLISH_SAMPLES.map((s) => s.text);
      continue;
    }

    process.stdout.write(`  ${lang.name} (${lang.code})...`);
    const texts: string[] = [];
    for (const text of translations[lang.code]) {
      const result = await translate(text, { from: lang.code, to: "en" });
      texts.push(result.text);
    }
    toEnglishGoogle[lang.code] = texts;
    console.log(" done");
  }

  // Step 3: each language → EN (via Haiku)
  console.log("\n[3/3] Back-translating to English (Haiku)");
  for (const lang of LANGUAGES) {
    if (lang.code === "en") {
      toEnglishHaiku["en"] = ENGLISH_SAMPLES.map((s) => s.text);
      continue;
    }

    process.stdout.write(`  ${lang.name} (${lang.code})...`);
    const texts: string[] = [];
    for (const text of translations[lang.code]) {
      texts.push(await translateWithHaiku(text, lang.code, "en"));
    }
    toEnglishHaiku[lang.code] = texts;
    console.log(" done");
  }

  const cache: SamplesCache = {
    generatedAt: new Date().toISOString(),
    translations,
    toEnglish: {
      google: toEnglishGoogle,
      haiku: toEnglishHaiku,
    },
  };

  writeFileSync(SAMPLES_PATH, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`\nSaved to ${SAMPLES_PATH}\n`);
  return cache;
}

async function loadOrGenerateSamples(regenerate: boolean): Promise<SamplesCache> {
  if (!regenerate && existsSync(SAMPLES_PATH)) {
    const raw = readFileSync(SAMPLES_PATH, "utf-8");
    const cache: SamplesCache = JSON.parse(raw);
    if (cache.toEnglish) {
      console.log(`Using cached samples (generated: ${cache.generatedAt})\n`);
      return cache;
    }
    console.log("Cache missing back-translations, regenerating...\n");
  }
  return generateSamples();
}

// ── Token counting ──

async function countTokens(content: string): Promise<number> {
  const result = await client.messages.countTokens({
    model: MODEL,
    messages: [{ role: "user", content }],
  });
  return result.input_tokens;
}

// ── Types ──

interface SampleResult {
  label: string;
  origTokens: number;
  enTokens: number;
  googleEnTokens: number;
  haikuEnTokens: number;
}

interface LangResult {
  lang: Language;
  samples: SampleResult[];
  avgReduction: number;
}

// ── Main ──

async function main() {
  const regenerate = process.argv.includes("--regenerate");
  const cache = await loadOrGenerateSamples(regenerate);

  console.log("mercury Multilingual Token Reduction Benchmark");
  console.log("=".repeat(80));
  console.log(`Model: ${MODEL}`);
  console.log(`Languages: ${LANGUAGES.length} (incl. English sanity check)`);
  console.log();

  // Count English tokens first (baseline)
  process.stdout.write("Counting English baseline tokens...");
  const enTokens: number[] = [];
  for (const sample of ENGLISH_SAMPLES) {
    enTokens.push(await countTokens(sample.text));
  }
  console.log(" done");

  // Count tokens for each language
  const results: LangResult[] = [];
  const toEnglish = cache.toEnglish!;

  for (const lang of LANGUAGES) {
    process.stdout.write(`Counting tokens: ${lang.name}...`);
    const texts = cache.translations[lang.code];
    if (!texts) {
      console.log(" SKIP (no samples)");
      continue;
    }

    const samples: SampleResult[] = [];
    let totalOrig = 0;
    let totalEn = 0;

    for (let i = 0; i < texts.length; i++) {
      const isEn = lang.code === "en";
      const origTokens = isEn ? enTokens[i] : await countTokens(texts[i]);
      const googleEnTokens = isEn
        ? enTokens[i]
        : await countTokens(toEnglish.google[lang.code][i]);
      const haikuEnTokens = isEn
        ? enTokens[i]
        : await countTokens(toEnglish.haiku[lang.code][i]);

      samples.push({
        label: ENGLISH_SAMPLES[i].label,
        origTokens,
        enTokens: enTokens[i],
        googleEnTokens,
        haikuEnTokens,
      });
      totalOrig += origTokens;
      totalEn += enTokens[i];
    }

    const avgReduction = lang.code === "en"
      ? 0
      : ((1 - totalEn / totalOrig) * 100);

    results.push({ lang, samples, avgReduction });
    console.log(" done");
  }

  // Sort by reduction (descending), English last
  const sorted = [...results].sort((a, b) => {
    if (a.lang.code === "en") return 1;
    if (b.lang.code === "en") return -1;
    return b.avgReduction - a.avgReduction;
  });

  // ── Section 1: LANGUAGE COMPARISON ──
  console.log();
  console.log("=".repeat(80));
  console.log("LANGUAGE COMPARISON (token counts: original → English)");
  console.log("=".repeat(80));
  console.log();

  const nameWidth = Math.max(...results.map((r) => r.lang.name.length));
  const sampleLabels = ENGLISH_SAMPLES.map((s) => s.label);

  // Header
  let header = `  ${"Language".padEnd(nameWidth)}`;
  for (const label of sampleLabels) {
    header += `   ${label.padStart(16)}`;
  }
  header += "     Avg";
  console.log(header);

  let separator = `  ${"─".repeat(nameWidth)}`;
  for (const _ of sampleLabels) {
    separator += `   ${"─".repeat(16)}`;
  }
  separator += "   ─────";
  console.log(separator);

  for (const r of results) {
    let line = `  ${r.lang.name.padEnd(nameWidth)}`;
    for (const s of r.samples) {
      const reduction = r.lang.code === "en"
        ? "0.0%"
        : `${((1 - s.enTokens / s.origTokens) * 100).toFixed(1)}%`;
      const cell = `${s.origTokens}→${s.enTokens} ${reduction}`;
      line += `   ${cell.padStart(16)}`;
    }
    line += `   ${r.avgReduction.toFixed(1).padStart(4)}%`;
    console.log(line);
  }

  // ── Section 2: RANKING ──
  console.log();
  console.log("=".repeat(80));
  console.log("RANKING (by average token reduction)");
  console.log("=".repeat(80));
  console.log();

  console.log(`  ${"#".padStart(2)}  ${"Language".padEnd(nameWidth)}  ${"Script".padEnd(12)}  Reduction`);
  console.log(`  ${"─".repeat(2)}  ${"─".repeat(nameWidth)}  ${"─".repeat(12)}  ─────────`);

  let rank = 1;
  for (const r of sorted) {
    if (r.lang.code === "en") {
      console.log(`   -  ${r.lang.name.padEnd(nameWidth)}  ${r.lang.script.padEnd(12)}  ${r.avgReduction.toFixed(1)}% (sanity check)`);
    } else {
      console.log(`  ${String(rank).padStart(2)}  ${r.lang.name.padEnd(nameWidth)}  ${r.lang.script.padEnd(12)}  ${r.avgReduction.toFixed(1)}%`);
      rank++;
    }
  }

  // ── Section 3: TRANSLATION FIDELITY ──
  // Compare: tokens(lang→EN translation) vs tokens(original EN)
  // Ratio close to 1.0 = good information preservation
  console.log();
  console.log("=".repeat(80));
  console.log("TRANSLATION FIDELITY (tokens of lang→EN vs original EN, closer to 1.0 = better)");
  console.log("=".repeat(80));
  console.log();

  console.log(`  ${"Language".padEnd(nameWidth)}   ${"Google Free".padStart(14)}   ${"Haiku".padStart(14)}`);
  console.log(`  ${"─".repeat(nameWidth)}   ${"─".repeat(14)}   ${"─".repeat(14)}`);

  for (const r of sorted) {
    if (r.lang.code === "en") continue;

    const totalGoogleEn = r.samples.reduce((s, x) => s + x.googleEnTokens, 0);
    const totalHaikuEn = r.samples.reduce((s, x) => s + x.haikuEnTokens, 0);
    const totalOrigEn = r.samples.reduce((s, x) => s + x.enTokens, 0);

    const googleRatio = totalGoogleEn / totalOrigEn;
    const haikuRatio = totalHaikuEn / totalOrigEn;

    const fmtRatio = (ratio: number): string => {
      const pct = ((ratio - 1) * 100);
      const sign = pct >= 0 ? "+" : "";
      return `${ratio.toFixed(2)}x (${sign}${pct.toFixed(0)}%)`;
    };

    console.log(
      `  ${r.lang.name.padEnd(nameWidth)}   ${fmtRatio(googleRatio).padStart(14)}   ${fmtRatio(haikuRatio).padStart(14)}`,
    );
  }

  console.log();
  console.log("  1.00x = identical token count to original English (perfect fidelity)");
  console.log("  <1.00x = shorter than original → possible information loss");
  console.log("  >1.00x = longer than original → added verbosity or explanation");

  // ── Section 4: BACKEND COMPARISON ──
  console.log();
  console.log("=".repeat(80));
  console.log("BACKEND COMPARISON (token reduction by translation backend)");
  console.log("=".repeat(80));
  console.log();

  console.log(`  ${"Language".padEnd(nameWidth)}   ${"Orig tok".padStart(8)}   ${"Google→EN".padStart(10)}   ${"Haiku→EN".padStart(10)}   ${"Original EN".padStart(11)}`);
  console.log(`  ${"─".repeat(nameWidth)}   ${"─".repeat(8)}   ${"─".repeat(10)}   ${"─".repeat(10)}   ${"─".repeat(11)}`);

  for (const r of sorted) {
    if (r.lang.code === "en") continue;

    const totalOrig = r.samples.reduce((s, x) => s + x.origTokens, 0);
    const totalGoogleEn = r.samples.reduce((s, x) => s + x.googleEnTokens, 0);
    const totalHaikuEn = r.samples.reduce((s, x) => s + x.haikuEnTokens, 0);
    const totalOrigEn = r.samples.reduce((s, x) => s + x.enTokens, 0);

    const googleReduction = ((1 - totalGoogleEn / totalOrig) * 100).toFixed(0);
    const haikuReduction = ((1 - totalHaikuEn / totalOrig) * 100).toFixed(0);

    console.log(
      `  ${r.lang.name.padEnd(nameWidth)}   ${String(totalOrig).padStart(8)}   ${(totalGoogleEn + " (" + googleReduction + "%)").padStart(10)}   ${(totalHaikuEn + " (" + haikuReduction + "%)").padStart(10)}   ${String(totalOrigEn).padStart(11)}`,
    );
  }

  console.log();
  console.log("  Original EN = ground truth (EN text before translation to each language)");
  console.log("  Closer to Original EN with fewer tokens = ideal backend");

  // ── Section 5: COST SAVINGS (google-free backend) ──
  console.log();
  console.log("=".repeat(80));
  console.log("COST SAVINGS (google-free backend, translation cost = $0)");
  console.log("=".repeat(80));
  console.log();

  // Header
  let costHeader = `  ${"Language".padEnd(nameWidth)}`;
  for (const m of MODEL_PRICING) {
    costHeader += `   ${m.name.padStart(12)}`;
  }
  console.log(costHeader);

  let costSep = `  ${"─".repeat(nameWidth)}`;
  for (const _ of MODEL_PRICING) {
    costSep += `   ${"─".repeat(12)}`;
  }
  console.log(costSep);

  for (const r of sorted) {
    if (r.lang.code === "en") continue;

    const totalOrig = r.samples.reduce((s, x) => s + x.origTokens, 0);
    const totalEn = r.samples.reduce((s, x) => s + x.enTokens, 0);
    const reductionRatio = totalEn / totalOrig;

    let line = `  ${r.lang.name.padEnd(nameWidth)}`;
    for (const m of MODEL_PRICING) {
      const savingPct = ((1 - reductionRatio) * 100).toFixed(0);
      line += `   ${(savingPct + "% SAVES").padStart(12)}`;
    }
    console.log(line);
  }

  console.log();
  console.log("  Note: With google-free backend, translation cost is $0.");
  console.log("  Savings are purely from token reduction, equal across all models.");
  console.log("  For Haiku backend cost analysis, see: npm run benchmark");
  console.log();
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
