/** Plain-text report formatting shared by the tools (`output.render` prints it verbatim). */
export function formatReport(input) {
    const lines = [`# ${input.title}`, "", input.summary];
    const problemCount = input.problems?.length ?? 0;
    const warningCount = input.warnings?.length ?? 0;
    if (problemCount > 0) {
        lines.push("", `## 阻塞问题 (${problemCount})`, ...input.problems.map((item) => `- ${item}`));
    }
    if (warningCount > 0) {
        lines.push("", `## 警告 (${warningCount})`, ...input.warnings.map((item) => `- ${item}`));
    }
    if ((input.notes?.length ?? 0) > 0) {
        lines.push("", "## 说明", ...input.notes.map((item) => `- ${item}`));
    }
    for (const section of input.sections ?? []) {
        lines.push("", `## ${section.title}`, ...section.lines);
    }
    if ((input.nextSteps?.length ?? 0) > 0) {
        lines.push("", "## 下一步", ...input.nextSteps.map((item, index) => `${index + 1}. ${item}`));
    }
    return lines.join("\n");
}
/** `PASS` when nothing blocks, `FAIL` otherwise; used as the summary line. */
export function verdict(problems, warnings, extra) {
    const base = problems.length === 0
        ? `PASS — 未发现阻塞问题${warnings.length > 0 ? `（${warnings.length} 条警告）` : ""}`
        : `FAIL — ${problems.length} 个阻塞问题`;
    return extra === undefined ? base : `${base}。${extra}`;
}
export function codeBlock(text) {
    return ["```", text.trim(), "```"].join("\n");
}
/** Short human-readable list from a record, for info sections. */
export function inlineList(items) {
    return items.length === 0 ? "（空）" : items.join("、");
}
//# sourceMappingURL=report.js.map