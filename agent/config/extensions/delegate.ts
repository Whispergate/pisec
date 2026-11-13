/**
 * delegate: runs a self-contained task in a fresh pi process on the "delegateModel"
 * (optional; defaults to the session's model) and returns its short report. Keeps bulky tool output out of the orchestrator's context.
 * Inside a subagent (PISEC_SUBAGENT) it instead caps each tool result, saving the full output to a file.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { Type } from "typebox";

const MAX_REPORT = 6000;
const TIMEOUT_MS = 20 * 60 * 1000;
const CAP_HEAD = 6000;
const CAP_TAIL = 2000;

const brief = (dir) => `You are a subagent working for an orchestrating agent, not for the operator.
- You are the dedicated agent for this task: finish it, but do not widen it.
- Save raw command output to files under ${dir} and refer to them by absolute path.
- Do not create or edit research threads, reports or todo lists.
- The orchestrator reads only your final message, not files you write. End with a report of at most 30 lines: what you ran, what you observed (not conclusions), and the file paths. If anything failed, was skipped or blocked, say so in the first line.`;

export default function (pi) {
	if (process.env.PISEC_SUBAGENT) {
		pi.on("tool_result", (e) => {
			const text = e.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
			if (text.length <= CAP_HEAD + CAP_TAIL) return;
			const file = `${process.cwd()}/output-${e.toolCallId.replace(/[^\w-]/g, "_")}.txt`;
			writeFileSync(file, text);
			const cut = `\n[... ${text.length - CAP_HEAD - CAP_TAIL} chars cut; full output in ${file}: filter it with rg, head or tail ...]\n`;
			return { content: [...e.content.filter((c) => c.type !== "text"), { type: "text", text: text.slice(0, CAP_HEAD) + cut + text.slice(-CAP_TAIL) }] };
		});
		return;
	}

	pi.registerTool({
		name: "delegate",
		label: "delegate",
		description:
			"Run a self-contained task in a fresh subagent and get back a short report with paths to its raw output. The subagent has none of your context: describe the goal, targets, constraints and what to report.",
		parameters: Type.Object({
			task: Type.String({ description: "Complete, self-contained task description" }),
		}),
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const model = pi.getSettings().delegateModel || (ctx.model && `${ctx.model.provider}/${ctx.model.id}`);
			if (!model) throw new Error("delegate: no model available; do the task yourself.");

			const dir = `/usr/local/shared/work/${toolCallId.replace(/[^\w-]/g, "_")}`;
			mkdirSync(dir, { recursive: true });

			// Subagents load the audit log, loop guard and this file's output cap: no delegate, todo or advisor.
			const ext = "/root/.pi/agent/extensions";
			const args = ["-p", "--model", model, "--no-skills", "--no-extensions", "-e", `${ext}/audit.ts`, "-e", `${ext}/loop-guard.ts`,
				"-e", `${ext}/delegate.ts`, "--tools", "read,bash", "--append-system-prompt", brief(dir), params.task];
			const child = spawn("pi", args, {
				cwd: dir,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, PISEC_SUBAGENT: "1" },
				signal,
				timeout: TIMEOUT_MS,
			});

			let out = "";
			let err = "";
			child.stdout.on("data", (d) => (out += d));
			child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
			const code = await new Promise((resolve) => {
				child.on("close", resolve);
				child.on("error", () => resolve(-1));
			});

			if (code !== 0) throw new Error(`delegate: subagent exited with ${code}. ${err.trim()}`);
			const report = out.length > MAX_REPORT ? `${out.slice(0, MAX_REPORT)}\n[report truncated; raw output in ${dir}]` : out;
			return { content: [{ type: "text", text: report.trim() || `(empty report; see ${dir})` }] };
		},
	});
}
