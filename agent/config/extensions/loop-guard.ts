/**
 * Loop guard for small/flash models. Catches the two ways they spin:
 *
 * 1. Degenerate streaming ("Hmm. Let me just... Hmm." x30) in the answer, the
 *    reasoning, or tool-call arguments. The run is aborted, the looped message
 *    is dropped from context, and the model is resumed once with a nudge.
 * 2. Tool loops: a call keeps returning the same result (even interleaved with
 *    other calls), or the identical call is spammed back to back. Repeats are
 *    blocked with a corrective reason; if that keeps happening the run aborts.
 *
 * /loopguard toggles the guard for the current session.
 */

const WINDOW = 300; // length of the repeating fragment to detect
const MIN_TAIL = 2000; // don't judge before this much has streamed
const TAIL = 8000; // rolling buffer per content block
// Repeats of the window inside the tail => loop. Tool arguments (file writes)
// legitimately repeat more, so they need far stronger evidence.
const OCCURRENCES = { text: 3, thinking: 3, toolcall: 8 };
const MAX_NUDGES = 1; // automatic resumes after a stream loop, per user prompt

const SAME_RESULT_BLOCK = 2; // prior identical call+result pairs before blocking
const CONSECUTIVE_BLOCK = 4; // identical calls in a row before blocking, results aside
const HISTORY = 20; // recent executed calls considered
const BLOCKS_ABORT = 3; // blocked calls in one run before aborting it

const NUDGE =
	"loop-guard: your previous response degenerated into repetition and was stopped (it was removed from context). " +
	"Do not repeat it. Check the todo list, state in one sentence where you are, then continue with a different approach.";

export default function (pi) {
	let enabled = true;

	const stable = (v) => {
		if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
		if (v && typeof v === "object")
			return `{${Object.keys(v).sort().map((k) => `${k}:${stable(v[k])}`).join(",")}}`;
		return JSON.stringify(v) ?? "null";
	};
	const hash = (s) => {
		let h = 0x811c9dc5;
		for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
		return h >>> 0;
	};

	// ── Stream repetition ──
	// A loop repeats exactly: the last `need` copies of the window must also be exactly periodic,
	// so requested repetition with varying parts (one paragraph under 12 headings) is not a loop.
	const isLoop = (tail, need) => {
		const window = tail.slice(-WINDOW);
		if (tail.split(window).length - 1 < need) return false;
		const period = tail.length - WINDOW - tail.lastIndexOf(window, tail.length - WINDOW - 1);
		const span = tail.slice(-(period * (need - 1) + WINDOW));
		return span.slice(0, -period) === span.slice(period);
	};
	const tails = new Map(); // contentIndex -> rolling text
	let streamLoop = false;
	let nudges = 0;
	const looped = new Set(); // timestamps of aborted, looping assistant messages

	pi.on("message_start", () => tails.clear());

	pi.on("message_update", (event, ctx) => {
		const e = event.assistantMessageEvent;
		if (!enabled || streamLoop || !e || typeof e.delta !== "string") return;
		const kind = e.type.replace(/_delta$/, "");
		if (!(kind in OCCURRENCES)) return;

		const tail = ((tails.get(e.contentIndex) ?? "") + e.delta).slice(-TAIL);
		tails.set(e.contentIndex, tail);
		if (tail.length < MIN_TAIL) return;

		if (isLoop(tail, OCCURRENCES[kind])) {
			streamLoop = true;
			ctx.abort();
			ctx.ui.notify(`loop-guard: repetition in ${kind} stream, run aborted (/loopguard to toggle)`, "warning");
		}
	});

	pi.on("message_end", (event) => {
		if (streamLoop && event.message?.role === "assistant") looped.add(event.message.timestamp);
	});

	pi.on("context", (event) => {
		if (looped.size === 0) return;
		return { messages: event.messages.filter((m) => !(m.role === "assistant" && looped.has(m.timestamp))) };
	});

	pi.on("input", (event) => {
		if (event.source !== "extension") nudges = 0;
	});

	pi.on("agent_settled", (event) => {
		const resume = streamLoop && event.aborted && nudges < MAX_NUDGES;
		streamLoop = false;
		if (!resume) return;
		nudges++;
		pi.sendUserMessage(NUDGE);
	});

	// ── Tool loops ──
	let history = []; // { sig, result } of executed calls, oldest first
	const pending = new Map(); // toolCallId -> sig
	let blocks = 0;

	pi.on("agent_start", () => {
		history = [];
		pending.clear();
		blocks = 0;
	});

	pi.on("tool_call", (event, ctx) => {
		if (!enabled) return;
		const sig = `${event.toolName}:${stable(event.input ?? {})}`;

		const same = history.filter((h) => h.sig === sig);
		const last = same.slice(-SAME_RESULT_BLOCK);
		const sameResult = last.length === SAME_RESULT_BLOCK && last.every((h) => h.result === last[0].result);
		let consecutive = 0;
		for (let i = history.length - 1; i >= 0 && history[i].sig === sig; i--) consecutive++;

		if (!sameResult && consecutive < CONSECUTIVE_BLOCK) {
			pending.set(event.toolCallId, sig);
			return;
		}

		if (++blocks >= BLOCKS_ABORT) {
			ctx.abort();
			ctx.ui.notify("loop-guard: persistent tool loop, run aborted", "warning");
			return { block: true, terminate: true, reason: "loop-guard: run aborted after repeated tool loops. Report the blocker to the user." };
		}
		const why = sameResult
			? `already ran ${same.length} times recently and returned the same result each time`
			: `was just made ${consecutive} times in a row`;
		return {
			block: true,
			reason: `loop-guard: this exact call ${why}. Do not retry it unchanged: use what you already have, change the approach, update the todo list, or report the blocker to the user.`,
		};
	});

	pi.on("tool_result", (event) => {
		const sig = pending.get(event.toolCallId);
		if (sig === undefined) return;
		pending.delete(event.toolCallId);
		history.push({ sig, result: hash(`${event.isError}:${JSON.stringify(event.content ?? "")}`) });
		if (history.length > HISTORY) history.shift();
	});

	pi.registerCommand("loopguard", {
		description: "Toggle the repetition loop guard",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(`loop-guard ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
