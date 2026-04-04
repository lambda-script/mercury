/**
 * mercury MCP Tool Result Token Reduction Benchmark
 *
 * Measures token reduction on realistic MCP tool result payloads
 * across 9 languages + English (sanity check).
 *
 * Simulates the actual MCP stdio proxy pipeline:
 *   MCP Server → tool result (non-EN text) → Mercury translate → Claude Code
 *
 * Tool results typically contain 500-5,000+ chars and may include
 * JSON, code blocks, or mixed content that Mercury skips.
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

// ── MCP tool result scenarios ──
// Each scenario simulates a realistic MCP tool result structure.
// "blocks" is an array of content blocks: text (translatable) or code/json (skipped).

interface ScenarioBlock {
  type: "text" | "code" | "json";
  content: string;
}

interface Scenario {
  label: string;
  description: string;
  blocks: ScenarioBlock[];
}

const SCENARIOS: Scenario[] = [
  {
    label: "Wiki article",
    description: "Single text block, typical wiki/knowledge-base article (~800 chars)",
    blocks: [
      {
        type: "text",
        content:
          "This document describes the authentication system architecture. " +
          "Our system uses OAuth 2.0 with PKCE for single-page applications and " +
          "standard authorization code flow for server-side applications. " +
          "Session tokens are stored in HTTP-only secure cookies with a maximum " +
          "lifetime of 24 hours. Refresh tokens are rotated on each use and " +
          "stored encrypted in the database. When a user logs in, the system " +
          "first checks the rate limiter to prevent brute force attacks. " +
          "Failed login attempts are tracked per IP address and per account. " +
          "After 5 failed attempts, the account enters a cooldown period of " +
          "15 minutes. Multi-factor authentication is required for all " +
          "administrative accounts and can be optionally enabled by regular users. " +
          "We support TOTP-based authenticator apps and WebAuthn hardware keys. " +
          "The system also implements a device trust mechanism that remembers " +
          "previously verified devices for 30 days.",
      },
    ],
  },
  {
    label: "API response + JSON",
    description: "Text description followed by JSON metadata (JSON skipped)",
    blocks: [
      {
        type: "text",
        content:
          "The search returned 3 results for the query about database migration procedures. " +
          "The most relevant result is the migration guide created last month, which covers " +
          "the step-by-step process for upgrading from PostgreSQL 14 to 16. It includes " +
          "sections on backup procedures, compatibility checks, and rollback strategies. " +
          "The second result discusses common pitfalls during schema migrations, including " +
          "issues with large table alterations and index rebuilding. The third result is a " +
          "troubleshooting guide for migration failures.",
      },
      {
        type: "json",
        content: JSON.stringify({
          total: 3,
          results: [
            { id: 42, title: "PostgreSQL 14→16 Migration Guide", score: 0.95, updated: "2026-03-15" },
            { id: 87, title: "Schema Migration Pitfalls", score: 0.82, updated: "2026-02-20" },
            { id: 103, title: "Migration Failure Troubleshooting", score: 0.71, updated: "2026-01-10" },
          ],
        }, null, 2),
      },
    ],
  },
  {
    label: "Docs + code",
    description: "Technical documentation with code examples (code skipped)",
    blocks: [
      {
        type: "text",
        content:
          "To configure the connection pool, you need to modify the application settings. " +
          "The connection pool manages database connections efficiently by reusing existing " +
          "connections instead of creating new ones for each request. The key parameters are " +
          "the minimum pool size, which determines the number of idle connections maintained, " +
          "and the maximum pool size, which limits the total number of concurrent connections. " +
          "For most production workloads, we recommend a minimum of 5 and maximum of 20 connections. " +
          "The idle timeout should be set to 10 minutes to release unused connections. " +
          "Connection validation should be enabled to detect stale connections before use.",
      },
      {
        type: "code",
        content:
          "```typescript\nconst poolConfig = {\n  min: 5,\n  max: 20,\n  idleTimeoutMillis: 600000,\n  " +
          "connectionTimeoutMillis: 5000,\n  validateOnBorrow: true,\n};\n\n" +
          "const pool = new Pool(poolConfig);\n" +
          "pool.on('error', (err) => {\n  logger.error('Unexpected pool error', err);\n});\n```",
      },
      {
        type: "text",
        content:
          "After configuring the pool, you should monitor connection usage through the metrics " +
          "endpoint. The dashboard shows active connections, waiting requests, and connection " +
          "creation rate. If you see frequent connection timeouts, consider increasing the " +
          "maximum pool size or optimizing long-running queries.",
      },
    ],
  },
  {
    label: "Long article",
    description: "Full article with multiple paragraphs (~2500 chars text)",
    blocks: [
      {
        type: "text",
        content:
          "The quarterly infrastructure review identified several areas requiring immediate " +
          "attention. First, our container orchestration platform needs to be upgraded from " +
          "Kubernetes 1.28 to 1.30 to address known security vulnerabilities and gain access " +
          "to new features like sidecar containers and improved pod scheduling. The upgrade " +
          "should be performed in stages, starting with the staging environment, then " +
          "proceeding to production after a two-week validation period.\n\n" +
          "Second, the monitoring stack requires significant improvements. The current " +
          "Prometheus setup is reaching its storage limits, and we need to either increase " +
          "retention capacity or migrate to a long-term storage solution like Thanos or " +
          "Cortex. Additionally, several critical services lack proper alerting rules, " +
          "which has led to delayed incident response times averaging 23 minutes compared " +
          "to our target of under 5 minutes.\n\n" +
          "Third, the CI/CD pipeline performance has degraded over the past quarter. " +
          "Average build times have increased from 8 minutes to 14 minutes, primarily due " +
          "to growing test suites and inefficient Docker layer caching. We recommend " +
          "implementing parallel test execution, optimizing Dockerfile layer ordering, " +
          "and introducing a build cache service. These improvements should reduce build " +
          "times back to under 10 minutes.\n\n" +
          "Finally, the disaster recovery procedures need to be tested and documented. " +
          "The last DR test was conducted over 6 months ago, and since then we have added " +
          "three new critical services without updating the recovery runbooks. We propose " +
          "scheduling a full DR simulation within the next month, including database " +
          "failover, DNS cutover, and service restoration in the secondary region. " +
          "The estimated recovery time objective should be under 4 hours for all " +
          "tier-1 services.",
      },
    ],
  },
  {
    label: "Mixed multi-block",
    description: "Realistic tool result: text + JSON + text + code + text",
    blocks: [
      {
        type: "text",
        content:
          "Here is the current status of the deployment pipeline. The latest release " +
          "candidate has passed all automated tests and is ready for production deployment. " +
          "Three critical bug fixes are included in this release.",
      },
      {
        type: "json",
        content: JSON.stringify({
          version: "2.4.1-rc.3",
          status: "ready",
          fixes: ["AUTH-1234", "DB-5678", "API-9012"],
          testsRun: 1847,
          testsPassed: 1847,
          coverage: 87.3,
        }, null, 2),
      },
      {
        type: "text",
        content:
          "The deployment requires a database migration that adds two new columns to the " +
          "users table. The migration has been tested against a copy of the production " +
          "database and completed in 3.2 seconds with no locks on active queries. " +
          "After deployment, the cache warming job should be triggered to prevent " +
          "cold-start latency for the first batch of requests.",
      },
      {
        type: "code",
        content:
          "```sql\nALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT false;\n" +
          "ALTER TABLE users ADD COLUMN last_device_id UUID REFERENCES devices(id);\n" +
          "CREATE INDEX CONCURRENTLY idx_users_mfa ON users(mfa_enabled) WHERE mfa_enabled = true;\n```",
      },
      {
        type: "text",
        content:
          "The rollback procedure involves reverting the database migration and redeploying " +
          "the previous version. The estimated rollback time is under 5 minutes. Please " +
          "coordinate with the on-call team before proceeding with the deployment.",
      },
    ],
  },
];

// ── Sample cache ──

interface SamplesCache {
  version: 2;
  generatedAt: string;
  // scenario index → lang code → array of translated text blocks (only "text" type blocks)
  translations: Record<string, Record<string, string[]>>;
  // scenario index → lang code → array of back-translated text blocks
  toEnglish: {
    google: Record<string, Record<string, string[]>>;
  };
}

async function generateSamples(): Promise<SamplesCache> {
  console.log("Generating MCP tool result samples...\n");
  const translations: Record<string, Record<string, string[]>> = {};
  const toEnglishGoogle: Record<string, Record<string, string[]>> = {};

  for (let si = 0; si < SCENARIOS.length; si++) {
    const scenario = SCENARIOS[si];
    const textBlocks = scenario.blocks.filter((b) => b.type === "text");
    const key = String(si);
    translations[key] = {};
    toEnglishGoogle[key] = {};

    console.log(`[${si + 1}/${SCENARIOS.length}] ${scenario.label} (${textBlocks.length} text blocks)`);

    for (const lang of LANGUAGES) {
      if (lang.code === "en") {
        translations[key]["en"] = textBlocks.map((b) => b.content);
        toEnglishGoogle[key]["en"] = textBlocks.map((b) => b.content);
        continue;
      }

      process.stdout.write(`  ${lang.name}...`);

      // EN → lang
      const translated: string[] = [];
      for (const block of textBlocks) {
        const result = await translate(block.content, { from: "en", to: lang.code });
        translated.push(result.text);
      }
      translations[key][lang.code] = translated;

      // lang → EN (back-translate)
      const backTranslated: string[] = [];
      for (const text of translated) {
        const result = await translate(text, { from: lang.code, to: "en" });
        backTranslated.push(result.text);
      }
      toEnglishGoogle[key][lang.code] = backTranslated;

      console.log(" done");
    }
  }

  const cache: SamplesCache = {
    version: 2,
    generatedAt: new Date().toISOString(),
    translations,
    toEnglish: { google: toEnglishGoogle },
  };

  writeFileSync(SAMPLES_PATH, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`\nSaved to ${SAMPLES_PATH}\n`);
  return cache;
}

function isV2Cache(cache: unknown): cache is SamplesCache {
  return typeof cache === "object" && cache !== null && (cache as SamplesCache).version === 2;
}

async function loadOrGenerateSamples(regenerate: boolean): Promise<SamplesCache> {
  if (!regenerate && existsSync(SAMPLES_PATH)) {
    const raw = readFileSync(SAMPLES_PATH, "utf-8");
    const cache = JSON.parse(raw);
    if (isV2Cache(cache)) {
      console.log(`Using cached samples v2 (generated: ${cache.generatedAt})\n`);
      return cache;
    }
    console.log("Cache is v1 (old format), regenerating for MCP tool result scenarios...\n");
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

// Build the full tool result text (what Claude Code actually receives)
function buildToolResultText(scenario: Scenario, translatedTexts: string[]): string {
  let textIdx = 0;
  const parts: string[] = [];
  for (const block of scenario.blocks) {
    if (block.type === "text") {
      parts.push(translatedTexts[textIdx]);
      textIdx++;
    } else {
      // code and json blocks pass through untranslated
      parts.push(block.content);
    }
  }
  return parts.join("\n\n");
}

function buildOriginalText(scenario: Scenario): string {
  return scenario.blocks.map((b) => b.content).join("\n\n");
}

// ── Types ──

interface ScenarioResult {
  scenario: Scenario;
  origTokens: number;         // non-EN tool result tokens
  translatedTokens: number;   // after Mercury translates text→EN
  baselineEnTokens: number;   // original EN text (ground truth)
  textCharCount: number;      // chars in text blocks only
  skippedCharCount: number;   // chars in code/json blocks (skipped)
}

interface LangResult {
  lang: Language;
  scenarios: ScenarioResult[];
  totalOrigTokens: number;
  totalTranslatedTokens: number;
  totalBaselineTokens: number;
  avgReduction: number;
}

// ── Main ──

async function main() {
  const regenerate = process.argv.includes("--regenerate");
  const cache = await loadOrGenerateSamples(regenerate);

  console.log("mercury MCP Tool Result Token Reduction Benchmark");
  console.log("=".repeat(90));
  console.log(`Model: ${MODEL}`);
  console.log(`Languages: ${LANGUAGES.length} | Scenarios: ${SCENARIOS.length}`);
  console.log(`Pipeline: MCP Server → tool result → Mercury translate → Claude Code`);
  console.log();

  // Count baseline EN tokens for each scenario
  process.stdout.write("Counting English baseline tokens...");
  const baselineTokens: number[] = [];
  for (const scenario of SCENARIOS) {
    const fullText = buildOriginalText(scenario);
    baselineTokens.push(await countTokens(fullText));
  }
  console.log(" done\n");

  // Count tokens for each language
  const results: LangResult[] = [];

  for (const lang of LANGUAGES) {
    process.stdout.write(`Counting tokens: ${lang.name}...`);
    const scenarios: ScenarioResult[] = [];
    let totalOrig = 0;
    let totalTranslated = 0;
    let totalBaseline = 0;

    for (let si = 0; si < SCENARIOS.length; si++) {
      const scenario = SCENARIOS[si];
      const key = String(si);
      const textBlocks = scenario.blocks.filter((b) => b.type === "text");
      const skippedBlocks = scenario.blocks.filter((b) => b.type !== "text");

      const textCharCount = textBlocks.reduce((s, b) => s + b.content.length, 0);
      const skippedCharCount = skippedBlocks.reduce((s, b) => s + b.content.length, 0);

      if (lang.code === "en") {
        scenarios.push({
          scenario,
          origTokens: baselineTokens[si],
          translatedTokens: baselineTokens[si],
          baselineEnTokens: baselineTokens[si],
          textCharCount,
          skippedCharCount,
        });
        totalOrig += baselineTokens[si];
        totalTranslated += baselineTokens[si];
        totalBaseline += baselineTokens[si];
        continue;
      }

      // Build non-EN tool result (translated text blocks + original code/json)
      const langTexts = cache.translations[key][lang.code];
      const origFullText = buildToolResultText(scenario, langTexts);
      const origTokens = await countTokens(origFullText);

      // Build Mercury-translated result (back-translated text blocks + original code/json)
      const googleTexts = cache.toEnglish.google[key][lang.code];
      const translatedFullText = buildToolResultText(scenario, googleTexts);
      const translatedTokens = await countTokens(translatedFullText);

      scenarios.push({
        scenario,
        origTokens,
        translatedTokens,
        baselineEnTokens: baselineTokens[si],
        textCharCount,
        skippedCharCount,
      });
      totalOrig += origTokens;
      totalTranslated += translatedTokens;
      totalBaseline += baselineTokens[si];
    }

    const avgReduction = lang.code === "en"
      ? 0
      : ((1 - totalTranslated / totalOrig) * 100);

    results.push({
      lang,
      scenarios,
      totalOrigTokens: totalOrig,
      totalTranslatedTokens: totalTranslated,
      totalBaselineTokens: totalBaseline,
      avgReduction,
    });
    console.log(" done");
  }

  // Sort by reduction (descending), English last
  const sorted = [...results].sort((a, b) => {
    if (a.lang.code === "en") return 1;
    if (b.lang.code === "en") return -1;
    return b.avgReduction - a.avgReduction;
  });

  const nameW = Math.max(...results.map((r) => r.lang.name.length));

  // ── Section 1: SCENARIO OVERVIEW ──
  console.log();
  console.log("=".repeat(90));
  console.log("SCENARIO OVERVIEW");
  console.log("=".repeat(90));
  console.log();

  const labelW = Math.max(...SCENARIOS.map((s) => s.label.length));
  console.log(`  ${"Scenario".padEnd(labelW)}  ${"Text".padStart(6)}  ${"Skip".padStart(6)}  ${"Total".padStart(6)}  ${"Skip%".padStart(6)}  Description`);
  console.log(`  ${"─".repeat(labelW)}  ${"─".repeat(6)}  ${"─".repeat(6)}  ${"─".repeat(6)}  ${"─".repeat(6)}  ${"─".repeat(40)}`);

  for (const scenario of SCENARIOS) {
    const textChars = scenario.blocks.filter((b) => b.type === "text").reduce((s, b) => s + b.content.length, 0);
    const skipChars = scenario.blocks.filter((b) => b.type !== "text").reduce((s, b) => s + b.content.length, 0);
    const total = textChars + skipChars;
    const skipPct = total > 0 ? ((skipChars / total) * 100).toFixed(0) : "0";

    console.log(
      `  ${scenario.label.padEnd(labelW)}  ${String(textChars).padStart(6)}  ${String(skipChars).padStart(6)}  ${String(total).padStart(6)}  ${(skipPct + "%").padStart(6)}  ${scenario.description}`,
    );
  }

  // ── Section 2: PER-SCENARIO TOKEN REDUCTION ──
  console.log();
  console.log("=".repeat(90));
  console.log("TOKEN REDUCTION BY SCENARIO (original non-EN → after Mercury translation)");
  console.log("=".repeat(90));

  for (const r of sorted) {
    if (r.lang.code === "en") continue;

    console.log();
    console.log(`  ${r.lang.name} (${r.lang.script})`);
    console.log(`  ${"─".repeat(labelW)}  ${"─".repeat(8)}  ${"─".repeat(8)}  ${"─".repeat(8)}  ${"─".repeat(8)}`);
    console.log(`  ${"Scenario".padEnd(labelW)}  ${"Original".padStart(8)}  ${"Mercury".padStart(8)}  ${"Δ tok".padStart(8)}  ${"Saving".padStart(8)}`);
    console.log(`  ${"─".repeat(labelW)}  ${"─".repeat(8)}  ${"─".repeat(8)}  ${"─".repeat(8)}  ${"─".repeat(8)}`);

    for (const sr of r.scenarios) {
      const delta = sr.origTokens - sr.translatedTokens;
      const pct = ((1 - sr.translatedTokens / sr.origTokens) * 100).toFixed(1);
      console.log(
        `  ${sr.scenario.label.padEnd(labelW)}  ${String(sr.origTokens).padStart(8)}  ${String(sr.translatedTokens).padStart(8)}  ${String(-delta).padStart(8)}  ${(pct + "%").padStart(8)}`,
      );
    }

    console.log(
      `  ${"TOTAL".padEnd(labelW)}  ${String(r.totalOrigTokens).padStart(8)}  ${String(r.totalTranslatedTokens).padStart(8)}  ${String(-(r.totalOrigTokens - r.totalTranslatedTokens)).padStart(8)}  ${(r.avgReduction.toFixed(1) + "%").padStart(8)}`,
    );
  }

  // ── Section 3: RANKING ──
  console.log();
  console.log("=".repeat(90));
  console.log("RANKING (by average token reduction across all scenarios)");
  console.log("=".repeat(90));
  console.log();

  console.log(`  ${"#".padStart(2)}  ${"Language".padEnd(nameW)}  ${"Script".padEnd(12)}  ${"Orig tok".padStart(8)}  ${"Mercury".padStart(8)}  ${"Reduction".padStart(9)}`);
  console.log(`  ${"─".repeat(2)}  ${"─".repeat(nameW)}  ${"─".repeat(12)}  ${"─".repeat(8)}  ${"─".repeat(8)}  ${"─".repeat(9)}`);

  let rank = 1;
  for (const r of sorted) {
    if (r.lang.code === "en") {
      console.log(`   -  ${r.lang.name.padEnd(nameW)}  ${r.lang.script.padEnd(12)}  ${String(r.totalOrigTokens).padStart(8)}  ${String(r.totalTranslatedTokens).padStart(8)}  ${"0.0%".padStart(9)} (baseline)`);
    } else {
      console.log(`  ${String(rank).padStart(2)}  ${r.lang.name.padEnd(nameW)}  ${r.lang.script.padEnd(12)}  ${String(r.totalOrigTokens).padStart(8)}  ${String(r.totalTranslatedTokens).padStart(8)}  ${(r.avgReduction.toFixed(1) + "%").padStart(9)}`);
      rank++;
    }
  }

  // ── Section 4: TRANSLATION FIDELITY ──
  console.log();
  console.log("=".repeat(90));
  console.log("TRANSLATION FIDELITY (Mercury output tokens vs original EN, closer to 1.0 = better)");
  console.log("=".repeat(90));
  console.log();

  console.log(`  ${"Language".padEnd(nameW)}  ${"Mercury tok".padStart(11)}  ${"Orig EN tok".padStart(11)}  ${"Fidelity".padStart(14)}`);
  console.log(`  ${"─".repeat(nameW)}  ${"─".repeat(11)}  ${"─".repeat(11)}  ${"─".repeat(14)}`);

  for (const r of sorted) {
    if (r.lang.code === "en") continue;

    const ratio = r.totalTranslatedTokens / r.totalBaselineTokens;
    const pct = ((ratio - 1) * 100);
    const sign = pct >= 0 ? "+" : "";
    const fidelity = `${ratio.toFixed(2)}x (${sign}${pct.toFixed(0)}%)`;

    console.log(
      `  ${r.lang.name.padEnd(nameW)}  ${String(r.totalTranslatedTokens).padStart(11)}  ${String(r.totalBaselineTokens).padStart(11)}  ${fidelity.padStart(14)}`,
    );
  }

  console.log();
  console.log("  1.00x = identical token count to original English (perfect fidelity)");
  console.log("  <1.00x = shorter than original → possible information loss");
  console.log("  >1.00x = longer than original → added verbosity");

  // ── Section 5: COST SAVINGS ──
  console.log();
  console.log("=".repeat(90));
  console.log("ESTIMATED COST SAVINGS PER 1,000 TOOL CALLS (google-free backend, $0 translation)");
  console.log("=".repeat(90));
  console.log();

  // Average tokens per tool call (across all scenarios)
  const avgOrigPerCall = (lang: LangResult) => Math.round(lang.totalOrigTokens / SCENARIOS.length);
  const avgTransPerCall = (lang: LangResult) => Math.round(lang.totalTranslatedTokens / SCENARIOS.length);

  let costHeader = `  ${"Language".padEnd(nameW)}  ${"Avg tok/call".padStart(12)}`;
  for (const m of MODEL_PRICING) {
    costHeader += `  ${("$ " + m.name).padStart(14)}`;
  }
  console.log(costHeader);

  let costSep = `  ${"─".repeat(nameW)}  ${"─".repeat(12)}`;
  for (const _ of MODEL_PRICING) {
    costSep += `  ${"─".repeat(14)}`;
  }
  console.log(costSep);

  for (const r of sorted) {
    if (r.lang.code === "en") continue;

    const avgOrig = avgOrigPerCall(r);
    const avgTrans = avgTransPerCall(r);
    const savedPerCall = avgOrig - avgTrans;

    let line = `  ${r.lang.name.padEnd(nameW)}  ${(avgOrig + "→" + avgTrans).padStart(12)}`;
    for (const m of MODEL_PRICING) {
      const savedPer1k = (savedPerCall * 1000 * m.inputPrice) / 1_000_000;
      line += `  ${("$" + savedPer1k.toFixed(2)).padStart(14)}`;
    }
    console.log(line);
  }

  console.log();
  console.log("  Savings shown per 1,000 tool calls. Multiply by your daily tool call volume.");
  console.log("  google-free backend has $0 translation cost — savings are pure token reduction.");
  console.log();
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
