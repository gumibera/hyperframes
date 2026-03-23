# Configure Linting, Formatting, and Conventional Commits

**Linear issue:** [VA-851](https://linear.app/heygen/issue/VA-851/pre-migration-configure-eslint-prettier-and-conventional-commits)
**Date:** 2026-03-23
**Status:** Approved

## Context

The hyperframes monorepo (5 packages: cli, core, engine, producer, studio, ~261 TS/TSX files) has no linting or formatting enforcement. Code is clean by convention, but OSS contributors need automated guardrails. The goal is for the public repo's first commit to already have these configs in place with all code conforming.

## Decision: oxc Ecosystem + Lefthook

Instead of the traditional ESLint + Prettier + Husky stack, we use the oxc toolchain for speed and simplicity:

| Concern               | Tool                                         | Replaces            |
| --------------------- | -------------------------------------------- | ------------------- |
| Linting               | oxlint                                       | ESLint              |
| Formatting            | oxfmt (beta)                                 | Prettier            |
| Commit messages       | commitlint + @commitlint/config-conventional | —                   |
| Git hooks             | lefthook                                     | husky + lint-staged |
| Unused code detection | knip                                         | —                   |
| Editor consistency    | .editorconfig                                | —                   |

### Why oxlint + oxfmt over ESLint + Prettier

- ~30x faster formatting, significantly faster linting
- oxfmt includes import sorting and Tailwind class sorting with no plugins
- > 95% Prettier output compatibility
- Same compiler infrastructure (oxc) for both tools
- oxfmt is beta but used in production by Vue, Turborepo, Sentry

### Why lefthook over husky

- Parallel hook execution by default (oxlint + oxfmt run simultaneously)
- Single config file (`lefthook.yml`) replaces husky shell scripts + lint-staged config
- Native staged-file filtering (no lint-staged dependency)
- Native monorepo support
- Standalone Go binary, no Node.js runtime dependency for hooks

## Architecture: All-at-Root

All configuration lives at the monorepo root. No per-package config files. oxlint and oxfmt recurse into subdirectories naturally. This is the simplest setup for contributors — one place to look, one set of rules.

Per-package overrides can be added later via oxlint's `overrides` field if needed.

## Config Files

### `.oxlintrc.json`

oxlint configuration at monorepo root:

- `correctness` category enabled (oxlint's default — covers outright wrong or useless code; oxlint has no "recommended" category)
- React plugin enabled (for studio's JSX/TSX files)
- Nursery category excluded (not production-ready: false positives, no semver guarantees)
- TypeScript support enabled via tsconfig detection
- Type-aware rules deferred (e.g., `no-floating-promises`) — can enable later once baseline is clean
- Ignore patterns: `dist/`, `coverage/`, `node_modules/`

### `.oxfmtrc.json`

oxfmt configuration matching existing code style:

- Double quotes
- Semicolons
- 2-space indentation
- Trailing commas (all)
- Print width: 100

### `commitlint.config.js`

Extends `@commitlint/config-conventional`. Enforces conventional commit format (`feat:`, `fix:`, `refactor:`, etc.) on every commit, enabling automated changelog generation later.

### `lefthook.yml`

```yaml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{js,jsx,ts,tsx}"
      run: oxlint {staged_files}
    format:
      glob: "*.{js,jsx,ts,tsx,json,css,md,yaml,yml}"
      run: oxfmt --check {staged_files}

commit-msg:
  commands:
    commitlint:
      run: commitlint --edit "{1}"
```

Deliberate design choice: pre-commit runs `--check` (fail if unformatted) rather than auto-fixing. This keeps the developer aware of what changed and avoids silent mutations to staged files.

### `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

### `knip.config.ts`

Knip configuration scoped to the 5 monorepo packages for detecting unused exports, dependencies, and files.

## Scripts (root `package.json`)

```json
{
  "lint": "oxlint .",
  "lint:fix": "oxlint --fix .",
  "format": "oxfmt .",
  "format:check": "oxfmt --check .",
  "knip": "knip",
  "prepare": "lefthook install"
}
```

Note: `format` writes files in place (oxfmt's default). `format:check` is the dry-run equivalent for CI. The `prepare` script ensures lefthook hooks are installed automatically after `pnpm install`.

## Dev Dependencies (root `package.json`)

- `oxlint`
- `oxfmt`
- `@commitlint/cli`
- `@commitlint/config-conventional`
- `lefthook`
- `knip`

## CI Integration

Add a lint + format check job to the existing CI workflow (`.github/workflows/ci.yml`). This is essential because git hooks can be bypassed with `--no-verify`, and some contribution workflows (GitHub web editor, Codespaces) may not run hooks.

```yaml
lint-and-format:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
    - run: pnpm install --frozen-lockfile
    - run: pnpm lint
    - run: pnpm format:check
```

## CONTRIBUTING.md Update

Update CONTRIBUTING.md to document:

- New `pnpm lint`, `pnpm format`, `pnpm format:check` scripts
- lefthook git hooks are installed automatically via `pnpm install`
- Every commit (not just PR titles) must follow conventional commit format

## Baseline Formatting

A single commit runs `oxfmt .` across all source files to establish the formatted baseline. This happens in the internal repo before the OSS port so public history starts clean.

## Verification

After setup, both commands must exit with zero errors:

- `pnpm lint`
- `pnpm format:check`

All existing code must pass lint + format checks with no suppressions needed (if any are needed, they will be addressed individually).
