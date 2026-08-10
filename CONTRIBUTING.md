# Contributing to ScribeAside

Thanks for your interest in contributing to ScribeAside!

## Development setup

```bash
git clone https://github.com/smlfrysamuri/ScribeAside.git
cd ScribeAside
pnpm install
```

Press **F5** in VS Code to launch the extension in a development host.

## Commands

```bash
pnpm webpack          # Build both bundles
pnpm webpack-dev      # Build + watch mode
pnpm lint             # Biome check
pnpm format           # Biome auto-fix
pnpm compile          # TypeScript compile (for tests)
pnpm test:unit        # Run unit tests
pnpm test:e2e         # Run Playwright e2e tests (webview)
pnpm test:e2e:ui      # Playwright UI mode for debugging
pnpm test:integration # Run integration tests (launches VS Code)
```

## Making changes

1. **Create a branch** from `main`
2. **Make your changes** — keep PRs focused on one thing
3. **Add tests** for new functionality
4. **Run checks** — `pnpm lint && pnpm test:unit && pnpm webpack` should all pass
5. **Manual QA** — copy-paste `.github/test-content.md` into ScribeAside to verify features visually
6. **Add a changeset** — run `pnpm changeset` for any user-facing change
7. **Update test content** — if your change adds a user-facing feature, add a section to `.github/test-content.md`
8. **Open a PR** against `main`

## Commit conventions

Use conventional commits: `type(scope): message`

- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance, dependencies
- `docs:` — documentation only
- `test:` — adding or updating tests

## Code style

- **Biome** handles linting and formatting — run `pnpm format` before committing
- **TypeScript** — prefer arrow functions, don't export internal types unless needed
- **Product name** — always PascalCase `ScribeAside` in user-facing text; lowercase `scribeaside` only as an identifier prefix (commands, settings, CSS classes)

## Architecture

ScribeAside has two webpack bundles:

- **Extension host** (`src/extension.ts`, `src/*.ts`) — VS Code API, commands, storage
- **Webview** (`src/webview/*.ts`) — CodeMirror 6 editor, decorations, styles

See `CLAUDE.md` for detailed architecture documentation.

## License

By contributing, you agree that your contributions will be licensed under GPL-3.0-or-later.
