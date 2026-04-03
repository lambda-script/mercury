# mercury-mcp

Claude Code 用の翻訳プロキシ — 非英語テキストを英語に透過的に翻訳し、トークン消費を削減します。

## なぜ必要？

非英語言語は英語よりも大幅に多くのトークンを消費します。例えば日本語は同じ内容に対して英語の約 **3倍のトークン** を使用します。ユーザーメッセージを Claude に送信する前に英語に翻訳することで、大幅なコスト削減が可能です。翻訳コスト（Claude Haiku、約1/12の価格）は削減分を大きく下回ります。

## 仕組み

```
Claude Code ──→ mercury-mcp（翻訳）──→ Anthropic API
                 ├─ 言語検出（franc）
                 └─ 翻訳（Claude Haiku）
```

1. Anthropic Messages API へのリクエストをインターセプト
2. ユーザーメッセージ内の非英語テキストを検出
3. Claude Haiku を使用して英語に翻訳
4. 翻訳済みリクエストをアップストリーム API に転送
5. レスポンスはそのままストリーミング（Claude は英語で応答）

**重要**: `tool_use.input` は翻訳されません（JSON パラメータの破壊を防止）。

## クイックスタート

```bash
# インストール
npm install -g mercury-mcp

# プロキシ起動（ANTHROPIC_API_KEY が必要）
mercury-mcp http

# 別のターミナルで、プロキシ経由で Claude Code を使用
ANTHROPIC_BASE_URL=http://localhost:3100 claude
```

## 設定

すべての設定は環境変数で行います:

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `ANTHROPIC_API_KEY` | （必須） | Haiku 翻訳用 API キー |
| `MERCURY_PORT` | `3100` | プロキシのリスンポート |
| `MERCURY_TARGET_LANG` | `en` | 翻訳先言語 |
| `MERCURY_SOURCE_LANG` | `auto` | 翻訳元言語（`auto` で自動検出） |
| `MERCURY_UPSTREAM_URL` | `https://api.anthropic.com` | アップストリーム API URL |
| `MERCURY_MIN_DETECT_LENGTH` | `20` | 言語検出の最小テキスト長 |
| `MERCURY_LOG_LEVEL` | `info` | ログレベル: debug, info, warn, error |

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
```

## ライセンス

MIT
