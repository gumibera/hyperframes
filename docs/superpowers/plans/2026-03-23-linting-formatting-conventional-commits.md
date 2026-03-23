# Linting, Formatting, and Conventional Commits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure oxlint, oxfmt, commitlint, lefthook, knip, and editorconfig at the monorepo root so that all code passes lint + format checks with zero errors.

**Architecture:** All config at monorepo root, no per-package configs. Tools recurse into `packages/` naturally. Git hooks run oxlint + oxfmt in parallel on staged files, commitlint on commit messages.

**Tech Stack:** oxlint, oxfmt, @commitlint/cli, @commitlint/config-conventional, lefthook, knip

**Spec:** `docs/superpowers/specs/2026-03-23-linting-formatting-conventional-commits-design.md`

**Linear:** [VA-851](https://linear.app/heygen/issue/VA-851/pre-migration-configure-eslint-prettier-and-conventional-commits)

---

## File Map

| Action | File                       | Purpose                                                          |
| ------ | -------------------------- | ---------------------------------------------------------------- |
| Create | `.oxlintrc.json`           | oxlint config — recommended rules, React plugin, ignore patterns |
| Create | `.oxfmtrc.json`            | oxfmt config — double quotes, semicolons, 2-space indent         |
| Create | `commitlint.config.js`     | commitlint extending conventional config                         |
| Create | `lefthook.yml`             | Git hooks — pre-commit (lint+format) and commit-msg (commitlint) |
| Create | `.editorconfig`            | Editor settings — indent, charset, line endings                  |
| Create | `knip.config.ts`           | Unused code detection scoped to 5 packages                       |
| Modify | `package.json`             | Add devDeps, scripts (lint, format, knip, prepare)               |
| Modify | `.github/workflows/ci.yml` | Add lint-and-format job                                          |
| Modify | `CONTRIBUTING.md`          | Document new tooling and commit conventions                      |

---

**Note on task ordering:** Tasks 1–4 create config files. Tasks 5–6 create lefthook and editorconfig/knip. Tasks 7–8 fix lint errors and apply baseline formatting. Commits in Tasks 5–6 use `--no-verify` because the pre-commit hooks will fail until the baseline formatting pass (Task 8) is complete. After Task 8, all commits go through hooks normally.

---

## Task 1: Install dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install all dev dependencies**

```bash
cd /Users/vanceingalls/src/hyperframes
pnpm add -Dw oxlint oxfmt @commitlint/cli @commitlint/config-conventional lefthook knip
```

Expected: packages install successfully, `package.json` devDependencies updated, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Add scripts and prepare hook to root package.json**

Add these scripts to the `"scripts"` section of `package.json`:

```json
"lint": "oxlint .",
"lint:fix": "oxlint --fix .",
"format": "oxfmt .",
"format:check": "oxfmt --check .",
"knip": "knip",
"prepare": "lefthook install"
```

The full scripts section should look like:

```json
"scripts": {
  "dev": "pnpm studio",
  "build": "pnpm -r build",
  "build:producer": "pnpm --filter @hyperframes/producer build",
  "studio": "pnpm --filter @hyperframes/studio dev",
  "build:hyperframes-runtime": "pnpm --filter @hyperframes/core build:hyperframes-runtime",
  "build:hyperframes-runtime:modular": "pnpm --filter @hyperframes/core build:hyperframes-runtime:modular",
  "set-version": "tsx scripts/set-version.ts",
  "lint": "oxlint .",
  "lint:fix": "oxlint --fix .",
  "format": "oxfmt .",
  "format:check": "oxfmt --check .",
  "knip": "knip",
  "prepare": "lefthook install"
}
```

- [ ] **Step 3: Run prepare to install lefthook hooks**

```bash
pnpm run prepare
```

Expected: `lefthook install` runs (will warn about missing config — that's fine, we create it next).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add oxlint, oxfmt, commitlint, lefthook, knip dependencies

VA-851"
```

---

## Task 2: Create oxlint config

**Files:**

- Create: `.oxlintrc.json`

- [ ] **Step 1: Create `.oxlintrc.json` at monorepo root**

```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error"
  },
  "plugins": ["react", "typescript"],
  "ignorePatterns": ["dist/", "coverage/", "node_modules/"]
}
```

- [ ] **Step 2: Verify oxlint runs without config errors**

```bash
pnpm lint
```

Expected: oxlint runs against all files. May report lint errors — that's expected and will be fixed in Task 7.

- [ ] **Step 3: Commit**

```bash
git add .oxlintrc.json
git commit -m "build: add oxlint config with recommended rules and React plugin

VA-851"
```

---

## Task 3: Create oxfmt config

**Files:**

- Create: `.oxfmtrc.json`

- [ ] **Step 1: Create `.oxfmtrc.json` at monorepo root**

```json
{
  "singleQuote": false,
  "semi": true,
  "useTabs": false,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100
}
```

Note: Field names follow Prettier conventions (confirmed via https://oxc.rs/docs/guide/usage/formatter/config-file-reference). All values above match the defaults except `trailingComma: "all"` and `printWidth: 100`, which are also oxfmt defaults — but we set them explicitly for clarity.

- [ ] **Step 2: Verify oxfmt runs without config errors**

```bash
pnpm format:check
```

Expected: oxfmt runs. Will likely report formatting differences — that's expected and will be resolved in Task 8.

- [ ] **Step 3: Commit**

```bash
git add .oxfmtrc.json
git commit -m "build: add oxfmt config matching existing code style

VA-851"
```

---

## Task 4: Create commitlint config

**Files:**

- Create: `commitlint.config.js`

- [ ] **Step 1: Create `commitlint.config.js` at monorepo root**

```js
export default {
  extends: ["@commitlint/config-conventional"],
};
```

Note: Uses ESM `export default` because the root `package.json` has `"type": "module"`.

- [ ] **Step 2: Verify commitlint works**

```bash
echo "feat: test message" | npx commitlint
```

Expected: exits 0 (valid).

```bash
echo "bad commit message" | npx commitlint
```

Expected: exits non-zero with an error about the subject format.

- [ ] **Step 3: Commit**

```bash
git add commitlint.config.js
git commit -m "build: add commitlint config enforcing conventional commits

VA-851"
```

---

## Task 5: Create lefthook config

**Files:**

- Create: `lefthook.yml`

- [ ] **Step 1: Create `lefthook.yml` at monorepo root**

```yaml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{js,jsx,ts,tsx}"
      run: npx oxlint {staged_files}
    format:
      glob: "*.{js,jsx,ts,tsx,json,css,md,yaml,yml}"
      run: npx oxfmt --check {staged_files}

commit-msg:
  commands:
    commitlint:
      run: npx commitlint --edit "{1}"
```

Note: Commands use `npx` prefix because bare binary names are not on PATH in the lefthook execution context.

- [ ] **Step 2: Reinstall lefthook hooks to pick up the new config**

```bash
pnpm run prepare
```

Expected: `lefthook install` runs successfully, no warnings about missing config.

- [ ] **Step 3: Verify hooks are installed**

```bash
cat .git/hooks/pre-commit | head -5
cat .git/hooks/commit-msg | head -5
```

Expected: Both files exist and reference lefthook.

- [ ] **Step 4: Commit (with --no-verify since baseline formatting hasn't been applied yet)**

```bash
git add lefthook.yml
git commit --no-verify -m "build: add lefthook git hooks for lint, format, and commitlint

VA-851"
```

---

## Task 6: Create editorconfig and knip config

**Files:**

- Create: `.editorconfig`
- Create: `knip.config.ts`

- [ ] **Step 1: Create `.editorconfig` at monorepo root**

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

- [ ] **Step 2: Create `knip.config.ts` at monorepo root**

```ts
import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    "packages/cli": {
      entry: ["src/cli.ts"],
    },
    "packages/core": {
      entry: ["src/index.ts", "src/lint/index.ts", "src/compiler/index.ts"],
    },
    "packages/engine": {
      entry: ["src/index.ts"],
    },
    "packages/producer": {
      entry: ["src/index.ts", "src/server.ts"],
    },
    "packages/studio": {
      entry: ["src/index.ts", "src/styles/tailwind-preset.ts"],
    },
  },
};

export default config;
```

Note: The entry points are derived from the `exports` and `bin` fields in each package's `package.json`. The producer's `./server` export builds from `src/server.ts` → `dist/public-server.js` (confirmed via `packages/producer/build.mjs`). Knip may flag script-only files (e.g., `benchmark.ts`, `parity-harness.ts`) as unused — this is expected since they are invoked via `tsx` in npm scripts, not as module exports. Review knip output and add these as entry points if the noise is excessive.

- [ ] **Step 3: Verify knip runs**

```bash
pnpm knip
```

Expected: knip runs and may report unused exports/dependencies. Review output but do not fix anything now — knip cleanup is informational for this ticket, not blocking.

- [ ] **Step 4: Commit (with --no-verify since baseline formatting hasn't been applied yet)**

```bash
git add .editorconfig knip.config.ts
git commit --no-verify -m "build: add editorconfig and knip config

VA-851"
```

---

## Task 7: Fix lint errors

**Files:**

- Modify: various source files as needed

- [ ] **Step 1: Run lint and capture output**

```bash
pnpm lint 2>&1 | head -100
```

Review the errors. Common categories:

- Unused variables/imports → remove them
- React-specific issues → fix or disable specific rules in `.oxlintrc.json` if they conflict with the codebase's patterns

- [ ] **Step 2: Auto-fix what oxlint can fix**

```bash
pnpm lint:fix
```

- [ ] **Step 3: Run lint again to see remaining errors**

```bash
pnpm lint
```

Expected: fewer errors. Manually fix any remaining issues.

- [ ] **Step 4: If any rules produce false positives across the codebase, disable them in `.oxlintrc.json`**

Add a `"rules"` section to `.oxlintrc.json` to disable problematic rules:

```json
{
  "rules": {
    "rule-name": "off"
  }
}
```

Only disable rules that are genuinely false positives for this codebase, not rules that catch real issues.

- [ ] **Step 5: Verify zero lint errors**

```bash
pnpm lint
```

Expected: exit 0, no errors.

- [ ] **Step 6: Commit (with --no-verify since baseline formatting hasn't been applied yet)**

Review `git status` before staging to avoid including unrelated files.

```bash
git add -A
git commit --no-verify -m "fix: resolve oxlint errors across codebase

VA-851"
```

---

## Task 8: Run baseline formatting

**Files:**

- Modify: all source files

- [ ] **Step 1: Run oxfmt across the entire codebase**

```bash
pnpm format
```

Expected: oxfmt reformats files in place.

- [ ] **Step 2: Verify format check passes**

```bash
pnpm format:check
```

Expected: exit 0, no formatting issues.

- [ ] **Step 3: Review the diff to sanity-check formatting changes**

```bash
git diff --stat
```

Skim a few changed files to verify the formatting looks correct (double quotes, semicolons, 2-space indent, trailing commas).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "style: apply oxfmt baseline formatting across all source files

VA-851"
```

---

## Task 9: Add CI lint-and-format job

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add lint-and-format job to CI workflow**

Add this job to `.github/workflows/ci.yml`. It runs independently (no `needs:` dependency on other jobs), matching the existing pattern where all jobs run in parallel:

```yaml
lint-and-format:
  name: Lint & Format
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with:
        version: 10
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm lint
    - run: pnpm format:check
```

Note: Matches the existing CI job pattern (same pnpm version, node version, checkout action). Timeout is 5 minutes since lint+format should be fast.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint and format check job

VA-851"
```

---

## Task 10: Update CONTRIBUTING.md

**Files:**

- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Add linting and formatting section**

Add a new section after the "Running Tests" section and before "Pull Requests":

````markdown
### Linting & Formatting

```bash
pnpm lint            # Run oxlint
pnpm lint:fix        # Run oxlint with auto-fix
pnpm format          # Format all files with oxfmt
pnpm format:check    # Check formatting without writing
```
````

Git hooks (via [lefthook](https://github.com/evilmartians/lefthook)) run automatically after `pnpm install` and enforce linting + formatting on staged files before each commit.

````

- [ ] **Step 2: Update the Pull Requests section**

Change the conventional commit line from:

```markdown
- Use [conventional commit](https://www.conventionalcommits.org/) format for PR titles (e.g., `feat: add timeline export`, `fix: resolve seek overflow`)
````

to:

```markdown
- Use [conventional commit](https://www.conventionalcommits.org/) format for **all commits** (e.g., `feat: add timeline export`, `fix: resolve seek overflow`). Enforced by a git hook.
```

- [ ] **Step 3: Update the Development scripts block**

Add `pnpm lint` and `pnpm format:check` to the existing development commands block:

````markdown
```bash
pnpm install        # Install all dependencies
pnpm dev            # Run the studio (composition editor)
pnpm build          # Build all packages
pnpm -r typecheck   # Type-check all packages
pnpm lint           # Lint all packages
pnpm format:check   # Check formatting
```
````

````

- [ ] **Step 4: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: update CONTRIBUTING.md with linting, formatting, and commit conventions

VA-851"
````

---

## Task 11: Final verification

- [ ] **Step 1: Run full lint check**

```bash
pnpm lint
```

Expected: exit 0, zero errors.

- [ ] **Step 2: Run full format check**

```bash
pnpm format:check
```

Expected: exit 0, zero formatting issues.

- [ ] **Step 3: Run typecheck to confirm formatting didn't break anything**

```bash
pnpm -r typecheck
```

Expected: exit 0, no type errors.

- [ ] **Step 4: Run build to confirm nothing is broken**

```bash
pnpm build
```

Expected: all packages build successfully.

- [ ] **Step 5: Test the git hooks end-to-end**

Create a test file and try to commit with a bad message:

```bash
echo "// test" > test-hooks.ts
git add test-hooks.ts
git commit -m "bad message"
```

Expected: commitlint rejects the commit.

```bash
git commit -m "test: verify git hooks work"
```

Expected: commit succeeds (lint + format pass on the test file, commitlint passes).

```bash
git rm test-hooks.ts
git commit -m "chore: remove test file"
```

- [ ] **Step 6: Run knip for informational output**

```bash
pnpm knip
```

Review output. Do not fix anything — this is informational for future cleanup.

- [ ] **Step 7: Confirm all verification passes, mark task complete**

All of these must exit 0:

- `pnpm lint`
- `pnpm format:check`
- `pnpm -r typecheck`
- `pnpm build`
