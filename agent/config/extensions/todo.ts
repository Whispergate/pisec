/**
 * todo — minimal task-list tool for pi.
 *
 * Design: the model sends the COMPLETE task list on every call and it replaces
 * the previous state wholesale (the TodoWrite pattern). No ids, no actions, no
 * dependency graph, no tombstones — every drift in the model's task state is
 * overwritten by the next call, which is what keeps flash models from looping
 * on long tasks. One `in_progress` task at a time is enforced here, in code.
 *
 * State is in-memory: it survives compaction (extension state is untouched),
 * resets on /reload or restart (the model rebuilds it from the transcript).
 */

import { Type } from "typebox";

const MAX_TASKS = 30;
const STATUSES = ["pending", "in_progress", "completed"] as const;
type Status = (typeof STATUSES)[number];

interface Task {
	task: string;
	status: Status;
}

let tasks: Task[] = [];

function render(): string {
	if (tasks.length === 0) return "(no tasks)";
	const done = tasks.filter((t) => t.status === "completed").length;
	const lines = tasks.map((t) => {
		const box = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
		return `${box} ${t.task}`;
	});
	return `Tasks (${done}/${tasks.length} done):\n${lines.join("\n")}`;
}

export default function (pi) {
	pi.registerTool({
		name: "todo",
		label: "todo",
		description:
			"Write the complete task list for multi-step work. Replaces the previous list entirely — always send EVERY task with its current status, in order. Exactly one task may be in_progress (unless all are completed). Send an empty list when the work is finished to clear it.",
		promptSnippet: "Track multi-step work with the todo tool",
		promptGuidelines: [
			"For work with 3+ steps, write the milestones with `todo` (status pending) before starting, then set the first one in_progress.",
			"Mark a task in_progress before starting it and completed only after verifying the result. Never batch completions. Exactly one task in_progress at a time.",
			"Every todo call replaces the whole list — always resend every task. If an approach fails twice, do not retry unchanged: add a task describing the new approach instead.",
		],
		parameters: Type.Object({
			tasks: Type.Array(
				Type.Object({
					task: Type.String({ description: "Short imperative description" }),
					status: Type.Union(STATUSES.map((s) => Type.Literal(s)), {
						description: "pending | in_progress | completed",
					}),
				}),
				{ description: "The complete task list, in execution order" },
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const list: Task[] = params.tasks.map((t) => ({ task: t.task.trim(), status: t.status }));

			if (list.length > MAX_TASKS)
				throw new Error(`todo: max ${MAX_TASKS} tasks (got ${list.length}). Split the work.`);
			if (list.some((t) => t.task.length === 0)) throw new Error("todo: empty task description.");

			const inProgress = list.filter((t) => t.status === "in_progress").length;
			const allDone = list.length > 0 && list.every((t) => t.status === "completed");
			if (list.length > 0 && !allDone && inProgress !== 1)
				throw new Error(
					"todo: exactly one task must be in_progress while work is ongoing (or send an empty list to clear).",
				);

			tasks = list;
			// Keep the list visible to the user above the editor until cleared.
			ctx.ui.setWidget("todo", tasks.length ? render().split("\n") : undefined);
			return { content: [{ type: "text", text: render() }] };
		},
	});

	pi.registerCommand("todos", {
		description: "Show the current task list",
		handler: async (_args, ctx) => {
			ctx.ui.notify(render(), "info");
		},
	});
}
