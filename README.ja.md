# @lambda-script/mercury

Claude Code 用の翻訳プロキシ — 非英語テキストを英語に透過的に翻訳し、トークン消費を削減します。

## なぜ必要？

非英語言語はトークナイザーの非効率性により、英語よりも大幅に多くのトークンを消費します。ユーザーメッセージを Claude に送信する前に英語に翻訳することで、言語に応じて入力トークンを 36〜72% 削減できます。

## 仕組み

```
Claude Code ──→ mercury（翻訳）──→ Anthropic API
                 ├─ 言語検出（franc）
                 └─ 翻訳（Google Translate / Claude Haiku）
```

1. Anthropic Messages API へのリクエストをインターセプト
2. ユーザーメッセージ内の非英語テキストを検出
3. 設定されたバックエンドで英語に翻訳
4. 翻訳済みリクエストをアップストリーム API に転送
5. レスポンスはそのままストリーミング（Claude は英語で応答）

**重要**: `tool_use.input` は翻訳されません（JSON パラメータの破壊を防止）。

## クイックスタート

```bash
# npx で即座に起動（インストール不要）
npx @lambda-script/mercury

# またはグローバルインストール
npm install -g @lambda-script/mercury
mercury

# 別のターミナルで、プロキシ経由で Claude Code を使用
ANTHROPIC_BASE_URL=http://localhost:3100 claude
```

デフォルトでは API キー不要です — Google Translate（非公式）を翻訳バックエンドとして使用します。

## 翻訳バックエンド

| バックエンド | `MERCURY_BACKEND` | API キー | 備考 |
|------------|-------------------|----------|------|
| **Google Translate（無料）** | `google-free`（デフォルト） | 不要 | `google-translate-api-x` を使用。登録不要。 |
| Claude Haiku | `haiku` | 必要（`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`） | 高品質だが LLM コストが発生。 |

## 設定

すべての設定は環境変数で行います:

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `MERCURY_BACKEND` | `google-free` | 翻訳バックエンド: `google-free`, `haiku` |
| `MERCURY_PORT` | `3100` | プロキシのリスンポート |
| `MERCURY_TARGET_LANG` | `en` | 翻訳先言語 |
| `MERCURY_SOURCE_LANG` | `auto` | 翻訳元言語（`auto` で自動検出） |
| `MERCURY_UPSTREAM_URL` | `https://api.anthropic.com` | アップストリーム API URL |
| `MERCURY_MIN_DETECT_LENGTH` | `20` | 言語検出の最小テキスト長 |
| `MERCURY_LOG_LEVEL` | `info` | ログレベル: debug, info, warn, error |

### Haiku バックエンドのみ

| 変数名 | 説明 |
|--------|------|
| `ANTHROPIC_API_KEY` | Haiku 翻訳用 API キー |
| `ANTHROPIC_AUTH_TOKEN` | OAuth トークン（API キーの代替）。`anthropic-beta: oauth-2025-04-20` ヘッダーは自動付与。 |

## ベンチマーク

[Anthropic トークンカウント API](https://docs.anthropic.com/en/docs/build-with-claude/token-counting)（`claude-sonnet-4-20250514` トークナイザー）で計測。各言語 3 サンプル（短文 ~30 tok、中文 ~80 tok、長文 ~170 tok）。

### 言語別トークン削減率

```
ヒンディー語   ████████████████████████████████████░░░░░░░░░░░░░░  72%  683 → 190 tok
アラビア語     ███████████████████████████████░░░░░░░░░░░░░░░░░░░  63%  511 → 190 tok
韓国語         ███████████████████████████████░░░░░░░░░░░░░░░░░░░  62%  501 → 190 tok
ロシア語       ██████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░  53%  406 → 190 tok
ドイツ語       █████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░  52%  394 → 190 tok
日本語         ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  49%  374 → 190 tok
フランス語     █████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  42%  328 → 190 tok
スペイン語     ███████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  39%  309 → 190 tok
中国語（簡体） ██████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  36%  297 → 190 tok
英語           ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%  (ベースライン)
```

### 翻訳忠実度（翻訳後の EN トークン数 vs 原文 EN トークン数）

1.00x に近いほど良好。原文の意味がどれだけ保持されているかの指標。

| 言語 | Google Free | Haiku |
|------|-------------|-------|
| ヒンディー語 | 0.98x (-2%) | 0.99x (-1%) |
| アラビア語 | 0.98x (-2%) | 1.02x (+2%) |
| 韓国語 | 1.06x (+6%) | 1.04x (+4%) |
| ロシア語 | 1.01x (+1%) | 1.04x (+4%) |
| ドイツ語 | 1.04x (+4%) | 1.04x (+4%) |
| 日本語 | 1.04x (+4%) | 1.04x (+4%) |
| フランス語 | 0.98x (-2%) | 1.02x (+2%) |
| スペイン語 | 1.00x (+0%) | 1.01x (+1%) |
| 中国語（簡体） | 0.95x (-5%) | 0.99x (-1%) |

両バックエンドとも、原文英語のトークン数から ~5% 以内の翻訳を生成。デフォルトの `google-free` バックエンドでは翻訳コスト $0。

ベンチマーク実行: `npm run benchmark:multi`（`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` が必要）

## 開発

```bash
# 依存パッケージのインストール
npm install

# ビルド
npm run build

# テスト実行
npm test

# カバレッジ付きテスト
npm run test:coverage

# ウォッチモード
npm run dev

# トークンコストベンチマーク
npm run benchmark
```

## アーキテクチャ

```
src/
├── index.ts              # CLI エントリポイント & バックエンド選択
├── config.ts             # 環境変数ベースの設定
├── detector/
│   ├── index.ts          # 検出器インターフェース
│   └── franc.ts          # franc ベースの言語検出
├── translator/
│   ├── index.ts          # 翻訳器インターフェース
│   ├── google-free.ts    # Google Translate（無料、API キー不要）
│   └── haiku.ts          # Claude Haiku バックエンド
├── transform/
│   └── messages.ts       # Messages API リクエスト変換
├── proxy/
│   └── http.ts           # HTTP プロキシサーバー（+ OAuth beta ヘッダー自動付与）
└── utils/
    └── logger.ts         # ログユーティリティ
```

## ライセンス

MIT
