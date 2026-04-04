# @lambda-script/mercury

MCP サーバー用の翻訳プロキシ — 非英語のツール結果を英語に透過的に翻訳し、トークン消費を削減します。

## なぜ必要？

非英語言語はトークナイザーの非効率性により、英語よりも大幅に多くのトークンを消費します。MCP ツール結果を Claude Code に返す前に英語に翻訳することで、言語に応じて入力トークンを 28〜64% 削減できます。

## 仕組み

```
Claude Code ──→ mercury（stdio プロキシ）──→ MCP Server
                 ├─ JSON-RPC ツール結果をインターセプト
                 ├─ 言語検出（franc）
                 ├─ 翻訳（Google Translate / Claude Haiku）
                 └─ コードブロック、エラー結果はスキップ; JSON 内の文字列は翻訳
```

1. MCP サーバーコマンドを stdio プロキシとしてラップ
2. 子 MCP サーバーからの JSON-RPC `tools/call` レスポンスをインターセプト
3. ツール結果のコンテンツブロック内の非英語テキストを検出
4. テキストブロックを設定されたバックエンドで英語に翻訳
5. JSON コンテンツはその構造を走査し、自然言語の文字列値を翻訳
6. コードブロック、画像、エラー結果はそのまま通過
7. 翻訳済み結果を Claude Code に返却

## 必要条件

- Node.js >= 20.0.0

## クイックスタート

`.mcp.json` で既存の MCP サーバーコマンドの前に `npx @lambda-script/mercury --` を追加するだけです。

### Google Translate（デフォルト、API キー不要）

```json
{
  "mcpServers": {
    "your-server": {
      "command": "npx",
      "args": ["@lambda-script/mercury", "--", "npx", "your-mcp-server"],
      "env": {
        "MERCURY_LOG_FILE": "/tmp/mercury.log"
      }
    }
  }
}
```

### Claude Haiku（高品質、API キー必須）

Claude Code は `ANTHROPIC_*` 環境変数を MCP サーバーに自動で渡しません — 明示的に設定してください:

```json
{
  "mcpServers": {
    "your-server": {
      "command": "npx",
      "args": ["@lambda-script/mercury", "--", "npx", "your-mcp-server"],
      "env": {
        "MERCURY_BACKEND": "haiku",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "MERCURY_LOG_FILE": "/tmp/mercury.log"
      }
    }
  }
}
```

## 翻訳バックエンド

| バックエンド | `MERCURY_BACKEND` | API キー | 備考 |
|------------|-------------------|----------|------|
| **Google Translate（無料）** | `google-free`（デ���ォルト） | 不要 | `google-translate-api-x` を使用。登録不要。長文の自動分割、TLD ローテーションによるリトライ。 |
| Claude Haiku | `haiku` | 必要（`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`） | 高品質だが LLM コストが発生。 |

## 設定

すべての設定は環��変数で行います:

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `MERCURY_BACKEND` | `google-free` | 翻訳バックエンド: `google-free`, `haiku` |
| `MERCURY_TARGET_LANG` | `en` | 翻訳先言語 |
| `MERCURY_SOURCE_LANG` | `auto` | 翻訳元言語（`auto` で自動検出） |
| `MERCURY_MIN_DETECT_LENGTH` | `20` | 言語検出の最小テキスト長 |
| `MERCURY_LOG_LEVEL` | `info` | ログレベル: debug, info, warn, error |
| `MERCURY_LOG_FILE` | *（なし）* | stderr の代わりにファイルにログ出力（MCP サーバーで stderr が見えない場合に有用） |
| `MERCURY_HAIKU_MODEL` | `claude-haiku-4-5-20251001` | haiku バックエンドのモデル ID |

### Haiku バックエンドのみ

| 変数名 | 説明 |
|--------|------|
| `ANTHROPIC_API_KEY` | Haiku 翻訳用 API キー |
| `ANTHROPIC_AUTH_TOKEN` | OAuth トークン（API キーの代替）。`anthropic-beta: oauth-2025-04-20` ヘッダーは自動付与。 |

## ベンチマーク

[Anthropic トークンカウント API](https://docs.anthropic.com/en/docs/build-with-claude/token-counting)（`claude-sonnet-4-20250514` トークナイザー）で計測。5 種類の実際的な MCP ツール結果シナリオ（Wiki 記事、JSON 付き API レスポンス、コードブロック付きドキュメント、長文記事、混合マルチブロック）を使用。

### 言語別トークン削減率

```
ヒンディー語   ████████████████████████████████░░░░░░░░░░░░░░░░░░░  64%  4009 → 1430 tok
アラビア語     ████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░  57%  3326 → 1424 tok
韓国語         █████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  51%  2927 → 1430 tok
ロシア語       █████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  43%  2513 → 1433 tok
日本語         ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  41%  2538 → 1488 tok
ドイツ語       ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  41%  2403 → 1430 tok
フランス語     ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  33%  2120 → 1427 tok
スペイン語     ███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  30%  2037 → 1424 tok
中国語（簡体） ██████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  28%  1992 → 1427 tok
英語           ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%  (ベースライン)
```

トークン数は全 5 シナリオの合計。JSON/コードブロックを含むシナリオ（Mercury がスキップ）はテキストのみのシナリオより削減率が低くなります。

### 翻訳忠実度（Mercury 出力トークン数 vs 原文 EN トークン数）

1.00x に近いほど良好。原文の意味がどれだけ保持されているかの指標。

| 言語 | Google Free |
|------|-------------|
| ヒンディー語 | 1.00x (+0%) |
| アラビア語 | 1.00x (+0%) |
| 韓国語 | 1.00x (+0%) |
| ロシア語 | 1.01x (+1%) |
| 日本語 | 1.04x (+4%) |
| ドイツ語 | 1.00x (+0%) |
| フランス語 | 1.00x (+0%) |
| スペイン語 | 1.00x (+0%) |
| 中国語（簡体） | 1.00x (+0%) |

google-free バックエンドは原文英語のトークン数から ~4% 以内の翻訳を生成。翻訳コスト $0。

ベンチ��ーク実行: `npm run benchmark`（`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` が必要）

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

# MCP ツール結果ベンチマーク
npm run benchmark
```

## アーキテクチャ

```
src/
├── index.ts              # CLI エントリポイント & バックエンド選択
├── config.ts             # 環境変数ベースの設定
├── detector/
│   ├── index.ts          # 検出器インターフェース
│   └── franc.ts          # franc + Unicode スクリプトベースの言語検出
├── translator/
│   ├── index.ts          # 翻訳器インターフェース
│   ├── google-free.ts    # Google Translate（無料、自動分割、TLD ローテーションリトライ）
│   └── haiku.ts          # Claude Haiku バックエンド
├── transform/
│   └── tool-result.ts    # MCP ツール結果翻訳（JSON 内文字列を翻訳、コード/エラーをスキップ）
├── proxy/
│   ├── stdio.ts          # MCP stdio プロキシ（JSON-RPC メッセージインターセプト）
│   └── tracker.ts        # JSON-RPC リクエスト ID → メソッド名トラッカー
└── utils/
    ├── logger.ts         # ログユーティリティ
    ├── lang.ts           # 言語名マッピング
    └── tokens.ts         # Unicode スクリプトベースのトークン推定
```

## ライセンス

MIT
