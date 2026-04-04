# Contributing to Mercury

Thank you for your interest in contributing to Mercury!

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- npm

### Getting Started

```bash
git clone https://github.com/lambda-script/mercury.git
cd mercury
npm install
npm test
```

### Available Commands

```bash
npm run build        # Build with tsup
npm run lint         # ESLint
npm run typecheck    # TypeScript type checking
npm test             # Run all tests
npm run test:coverage # Coverage report (80% threshold)
```

## Pull Request Workflow

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Ensure all checks pass:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```
5. Submit a pull request

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/). PR titles must follow this format:

```
feat: add new translation backend
fix: handle empty tool results
docs: update configuration examples
chore: update dependencies
refactor: simplify request tracking
test: add edge case coverage
perf: optimize chunk splitting
ci: add Node 22 to test matrix
```

### CI Requirements

All pull requests must pass:

- ESLint (no warnings)
- TypeScript type checking (`--noEmit`)
- All tests (vitest)

### Code Style

- **TypeScript** with strict mode
- **ESLint** for linting (flat config with typescript-eslint)
- **Immutability**: All interfaces use `readonly` properties; transform functions return new objects, never mutate inputs
- **ESM**: The project uses ES modules exclusively

## Reporting Issues

- Use [bug report](https://github.com/lambda-script/mercury/issues/new?template=bug_report.md) for bugs
- Use [feature request](https://github.com/lambda-script/mercury/issues/new?template=feature_request.md) for ideas

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
