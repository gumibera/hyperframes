import { defineCommand } from "citty";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import { lintProject } from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import { withMeta } from "../utils/updateCheck.js";

export default defineCommand({
  meta: { name: "lint", description: "Validate a composition for common mistakes" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output findings as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const lintResult = lintProject(project);

    if (args.json) {
      const combined = {
        ok: lintResult.totalErrors === 0,
        errorCount: lintResult.totalErrors,
        warningCount: lintResult.totalWarnings,
        findings: lintResult.results.flatMap((r) => r.result.findings),
      };
      console.log(JSON.stringify(withMeta(combined), null, 2));
      process.exit(combined.ok ? 0 : 1);
    }

    const fileCount = lintResult.results.length;
    const fileLabel =
      fileCount === 1 ? (lintResult.results[0]?.file ?? "index.html") : `${fileCount} files`;
    console.log(`${c.accent("◆")}  Linting ${c.accent(project.name + "/" + fileLabel)}`);
    console.log();

    if (lintResult.totalErrors === 0 && lintResult.totalWarnings === 0) {
      console.log(`${c.success("◇")}  ${c.success("0 errors, 0 warnings")}`);
      return;
    }

    const lines = formatLintFindings(lintResult, { showElementId: true, showSummary: true });
    for (const line of lines) console.log(line);

    process.exit(lintResult.totalErrors > 0 ? 1 : 0);
  },
});
