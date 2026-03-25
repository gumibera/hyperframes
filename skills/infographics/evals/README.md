# Infographics Skill Evals

Three scenarios testing whether the skill produces well-designed, correctly animated infographic compositions.

## Running

Each eval is a prompt + expected output criteria. Run each prompt in a fresh Claude Code session with the infographics skill installed, then score the output against the criteria.

```bash
# Install skills first
npx tsx packages/cli/src/cli.ts skills --claude

# Run each eval in a fresh session
claude "$(cat skills/infographics/evals/eval-1-single-stat.md)"
claude "$(cat skills/infographics/evals/eval-2-comparison.md)"
claude "$(cat skills/infographics/evals/eval-3-process-steps.md)"
```

## Scoring

Each eval has PASS/FAIL criteria. A criterion passes if the output meets the requirement. Score = passing criteria / total criteria.

**Target:** 80%+ pass rate across all evals.
