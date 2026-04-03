/**
 * mercury Token Cost Benchmark
 *
 * Measures actual token consumption for Japanese vs English text
 * using the Anthropic token counting API, then calculates net cost savings.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx benchmarks/token-cost.ts
 *   ANTHROPIC_AUTH_TOKEN=... npx tsx benchmarks/token-cost.ts
 */

import { config as dotenvConfig } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

dotenvConfig();

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

// Model pricing per 1M tokens (USD) - as of 2025
const PRICING = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.0 },
} as const;

type Model = keyof typeof PRICING;

const MAIN_MODEL: Model = "claude-sonnet-4-20250514";
const TRANSLATION_MODEL: Model = "claude-haiku-4-5-20251001";

// Sample texts: Japanese originals and their English translations
const SAMPLES = [
  {
    label: "Short question",
    ja: "このファイルのエラーハンドリングを改善してください。例外が発生した場合にユーザーにわかりやすいメッセージを表示するようにしたいです。",
    en: "Please improve the error handling in this file. I want to display user-friendly messages when exceptions occur.",
  },
  {
    label: "Bug report",
    ja: "本番環境でデータベース接続がタイムアウトする問題が発生しています。接続プールの設定を確認して、最適な値に調整してください。また、リトライロジックも追加してほしいです。エラーログを確認したところ、ピーク時間帯（午前9時〜11時）に集中して発生しているようです。",
    en: "We are experiencing database connection timeout issues in production. Please check the connection pool settings and adjust to optimal values. Also, please add retry logic. After checking the error logs, the issues appear to be concentrated during peak hours (9 AM to 11 AM).",
  },
  {
    label: "Architecture discussion",
    ja: "マイクロサービスアーキテクチャへの移行を検討しています。現在のモノリシックなアプリケーションを、ユーザー管理、注文処理、在庫管理、通知サービスの4つのサービスに分割したいと考えています。各サービス間の通信にはメッセージキューを使用し、APIゲートウェイでリクエストをルーティングする予定です。データの整合性を保つために、Sagaパターンの採用も検討しています。まず、この設計方針について意見をいただき、その後、段階的な移行計画を作成していただけますか？",
    en: "We are considering migrating to a microservices architecture. We want to split the current monolithic application into four services: user management, order processing, inventory management, and notification service. We plan to use message queues for inter-service communication and route requests through an API gateway. We are also considering adopting the Saga pattern to maintain data consistency. First, could you give your opinion on this design approach, and then create a phased migration plan?",
  },
  {
    label: "Code review request",
    ja: "プルリクエスト#342のコードレビューをお願いします。主な変更点は以下の通りです：1. 認証ミドルウェアのリファクタリング - JWTトークンの検証ロジックを共通化しました。2. レート制限の実装 - IPアドレスベースのスロットリングを追加しました。3. ログ出力の改善 - 構造化ログに移行し、リクエストIDでトレースできるようにしました。セキュリティの観点から特に注意して確認してください。",
    en: "Please review pull request #342. The main changes are: 1. Authentication middleware refactoring - centralized JWT token verification logic. 2. Rate limiting implementation - added IP address-based throttling. 3. Logging improvements - migrated to structured logging with request ID tracing. Please pay special attention from a security perspective.",
  },
  {
    label: "Multi-turn conversation (5 turns)",
    ja: [
      "TypeScriptでREST APIを作りたいです。Express.jsを使う予定です。",
      "データベースはPostgreSQLを使います。ORMはPrismaを使いたいです。テーブル設計も手伝ってもらえますか？",
      "ユーザーテーブル、投稿テーブル、コメントテーブルの3つが必要です。ユーザーは複数の投稿を持ち、各投稿には複数のコメントがつけられます。",
      "認証はJWTを使いたいです。リフレッシュトークンも実装してください。パスワードはbcryptでハッシュ化します。",
      "テストも書いてください。Jestを使って、ユニットテストとインテグレーションテストの両方をカバーしたいです。モックはなるべく避けて、テストデータベースを使ったテストにしてください。",
    ].join("\n\n"),
    en: [
      "I want to create a REST API with TypeScript. I plan to use Express.js.",
      "I'll use PostgreSQL for the database. I want to use Prisma as the ORM. Can you also help with the table design?",
      "I need three tables: users, posts, and comments. A user can have multiple posts, and each post can have multiple comments.",
      "I want to use JWT for authentication. Please also implement refresh tokens. Passwords will be hashed with bcrypt.",
      "Please also write tests. I want to cover both unit tests and integration tests using Jest. Please avoid mocks as much as possible and use a test database instead.",
    ].join("\n\n"),
  },
];

interface TokenResult {
  label: string;
  jaTokens: number;
  enTokens: number;
  ratio: number;
  translationTokens: number;
  jaCost: number;
  enCostWithTranslation: number;
  savings: number;
  savingsPercent: number;
}

async function countTokens(content: string): Promise<number> {
  const result = await client.messages.countTokens({
    model: MAIN_MODEL,
    messages: [{ role: "user", content }],
  });
  return result.input_tokens;
}

async function countTranslationTokens(text: string): Promise<number> {
  const prompt = `Translate the following text from the source language to en. Output ONLY the translated text, nothing else. Do not add explanations, notes, or formatting.\n\n${text}`;
  const result = await client.messages.countTokens({
    model: TRANSLATION_MODEL,
    messages: [{ role: "user", content: prompt }],
  });
  return result.input_tokens;
}

function calcCost(tokens: number, model: Model, direction: "input" | "output"): number {
  return (tokens / 1_000_000) * PRICING[model][direction];
}

async function benchmarkSample(sample: { label: string; ja: string; en: string }): Promise<TokenResult> {
  const [jaTokens, enTokens, translationTokens] = await Promise.all([
    countTokens(sample.ja),
    countTokens(sample.en),
    countTranslationTokens(sample.ja),
  ]);

  // Estimate translation output tokens ≈ English tokens
  const translationOutputTokens = enTokens;

  // Cost without proxy: Japanese tokens at main model price
  const jaCost = calcCost(jaTokens, MAIN_MODEL, "input");

  // Cost with proxy: translation cost + English tokens at main model price
  const translationCost =
    calcCost(translationTokens, TRANSLATION_MODEL, "input") +
    calcCost(translationOutputTokens, TRANSLATION_MODEL, "output");
  const enCost = calcCost(enTokens, MAIN_MODEL, "input");
  const enCostWithTranslation = enCost + translationCost;

  const savings = jaCost - enCostWithTranslation;
  const savingsPercent = (savings / jaCost) * 100;

  return {
    label: sample.label,
    jaTokens,
    enTokens,
    ratio: jaTokens / enTokens,
    translationTokens,
    jaCost,
    enCostWithTranslation,
    savings,
    savingsPercent,
  };
}

function formatCost(usd: number): string {
  if (usd < 0.0001) return `$${(usd * 1000).toFixed(4)}/k`;
  return `$${usd.toFixed(6)}`;
}

async function main() {
  console.log("mercury Token Cost Benchmark");
  console.log("=".repeat(80));
  console.log();
  console.log(`Main model:        ${MAIN_MODEL}`);
  console.log(`Translation model: ${TRANSLATION_MODEL}`);
  console.log(`Main model pricing:        $${PRICING[MAIN_MODEL].input}/M input, $${PRICING[MAIN_MODEL].output}/M output`);
  console.log(`Translation model pricing: $${PRICING[TRANSLATION_MODEL].input}/M input, $${PRICING[TRANSLATION_MODEL].output}/M output`);
  console.log();

  const results: TokenResult[] = [];

  for (const sample of SAMPLES) {
    process.stdout.write(`Benchmarking: ${sample.label}...`);
    const result = await benchmarkSample(sample);
    results.push(result);
    console.log(" done");
  }

  // ── Token Reduction ──
  console.log();
  console.log("=".repeat(80));
  console.log("TOKEN REDUCTION (main model input tokens)");
  console.log("=".repeat(80));
  console.log();

  const labelWidth = Math.max(...results.map((r) => r.label.length));
  console.log(
    `  ${"Sample".padEnd(labelWidth)}   JA tok   EN tok   Reduction   Ratio`,
  );
  console.log(`  ${"─".repeat(labelWidth)}   ──────   ──────   ─────────   ─────`);

  for (const r of results) {
    const reduction = ((1 - r.enTokens / r.jaTokens) * 100).toFixed(1);
    console.log(
      `  ${r.label.padEnd(labelWidth)}   ${String(r.jaTokens).padStart(6)}   ${String(r.enTokens).padStart(6)}   ${(reduction + "%").padStart(9)}   ${r.ratio.toFixed(2)}x`,
    );
  }

  const totalJaTokens = results.reduce((s, r) => s + r.jaTokens, 0);
  const totalEnTokens = results.reduce((s, r) => s + r.enTokens, 0);
  const avgRatio = totalJaTokens / totalEnTokens;
  const totalReduction = ((1 - totalEnTokens / totalJaTokens) * 100).toFixed(1);

  console.log(`  ${"─".repeat(labelWidth)}   ──────   ──────   ─────────   ─────`);
  console.log(
    `  ${"TOTAL".padEnd(labelWidth)}   ${String(totalJaTokens).padStart(6)}   ${String(totalEnTokens).padStart(6)}   ${(totalReduction + "%").padStart(9)}   ${avgRatio.toFixed(2)}x`,
  );

  // ── Translation Overhead ──
  console.log();
  console.log("=".repeat(80));
  console.log("TRANSLATION OVERHEAD (Haiku tokens per request)");
  console.log("=".repeat(80));
  console.log();

  const totalTranslationTokens = results.reduce((s, r) => s + r.translationTokens, 0);

  console.log(
    `  ${"Sample".padEnd(labelWidth)}   JA tok   Haiku in   Overhead`,
  );
  console.log(`  ${"─".repeat(labelWidth)}   ──────   ────────   ────────`);

  for (const r of results) {
    // Overhead = translation prompt tokens - original JA tokens (prompt template portion)
    const overhead = r.translationTokens - r.jaTokens;
    console.log(
      `  ${r.label.padEnd(labelWidth)}   ${String(r.jaTokens).padStart(6)}   ${String(r.translationTokens).padStart(8)}   ${("+" + overhead).padStart(8)}`,
    );
  }

  const totalOverhead = totalTranslationTokens - totalJaTokens;
  console.log(`  ${"─".repeat(labelWidth)}   ──────   ────────   ────────`);
  console.log(
    `  ${"TOTAL".padEnd(labelWidth)}   ${String(totalJaTokens).padStart(6)}   ${String(totalTranslationTokens).padStart(8)}   ${("+" + totalOverhead).padStart(8)}`,
  );
  console.log();
  console.log(`  Prompt template overhead: ~${Math.round(totalOverhead / results.length)} tokens/request`);

  // ── Cost Analysis ──
  console.log();
  console.log("=".repeat(80));
  console.log("COST ANALYSIS");
  console.log("=".repeat(80));
  console.log();

  for (const r of results) {
    console.log(`  ${r.label}:`);
    console.log(`    Without proxy: ${formatCost(r.jaCost)}  |  With proxy: ${formatCost(r.enCostWithTranslation)}  |  ${r.savingsPercent >= 0 ? "Saving" : "Overhead"}: ${Math.abs(r.savingsPercent).toFixed(1)}%`);
  }

  const totalJaCost = results.reduce((s, r) => s + r.jaCost, 0);
  const totalEnCost = results.reduce((s, r) => s + r.enCostWithTranslation, 0);
  const totalSavings = totalJaCost - totalEnCost;
  const savingsRate = (totalSavings / totalJaCost) * 100;

  console.log();
  console.log(`  Total: without ${formatCost(totalJaCost)} → with proxy ${formatCost(totalEnCost)} (${savingsRate >= 0 ? "saving" : "overhead"} ${Math.abs(savingsRate).toFixed(1)}%)`);

  // ── Break-even by model ──
  console.log();
  console.log("=".repeat(80));
  console.log("BREAK-EVEN ANALYSIS (per 1M JA input tokens)");
  console.log("=".repeat(80));
  console.log();

  const models: { name: string; inputPrice: number }[] = [
    { name: "Haiku 4.5     ($0.80/M)", inputPrice: 0.80 },
    { name: "Sonnet 4.6    ($3.00/M)", inputPrice: 3.00 },
    { name: "Opus 4.5      ($15.0/M)", inputPrice: 15.00 },
  ];

  const translationCostPer1M =
    (1_000_000 / 1_000_000) * PRICING[TRANSLATION_MODEL].input +
    (1_000_000 / avgRatio / 1_000_000) * PRICING[TRANSLATION_MODEL].output;

  for (const m of models) {
    const withoutProxy = m.inputPrice; // 1M JA tokens
    const mainCostReduced = (1_000_000 / avgRatio / 1_000_000) * m.inputPrice;
    const withProxy = mainCostReduced + translationCostPer1M;
    const saving = ((1 - withProxy / withoutProxy) * 100).toFixed(1);
    const indicator = withProxy < withoutProxy ? "SAVES" : "COSTS MORE";
    console.log(`  ${m.name}:  $${withoutProxy.toFixed(2)} → $${withProxy.toFixed(2)}  (${saving}%) ${indicator}`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
