/**
 * advisor: lets the agent ask a reviewer model for a verdict and next steps at
 * decision points. Toggle and model come from settings.json:
 *   "advisorEnabled": true, "advisorModel": "<provider>/<model id>" (optional; defaults to the session's model)
 * When enabled, a prompt that took several tool calls but never consulted the advisor gets one
 * automatic follow-up asking for a final review before the answer.
 */

import { completeSimple } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const MAX_USES_PER_RUN = 3;
const RECENT_MESSAGES = 20;
const MAX_PART = 1500;
const MAX_PROMPT = 8000;
const REVIEW_AFTER_CALLS = 5;

const REVIEW =
	"advisor: before you finish, call the advisor tool once with your findings or answer, asking it to check them against your evidence " +
	"and to name anything you did not cover. Act on what it finds, then give your complete final answer again (not just the changes).";

const SYSTEM = `You advise an offensive-security research agent that does the work; you only see its transcript.
- Start with a one-line verdict: "On track", "Course-correct" or "Not done yet".
- Then at most 5 numbered action items, citing files, commands or outputs from the transcript.
- If the transcript lacks the evidence to judge, make the first item the exact command or read that would settle it. Never fill gaps with guesses.
- Respect the agent's scope and rules; never suggest working around them.`;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)} [...]` : s);

function render(m) {
	const parts = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }];
	const body = parts
		.map((p) => (p.type === "text" ? p.text : p.type === "toolCall" ? `[call ${p.name} ${JSON.stringify(p.arguments)}]` : ""))
		.filter(Boolean)
		.join("\n");
	const who = m.role === "toolResult" ? `tool result (${m.toolName}${m.isError ? ", error" : ""})` : m.role;
	return `## ${who}\n${clip(body, MAX_PART)}`;
}

export default function (pi) {
	const settings = () => pi.getSettings();
	let uses = 0;
	pi.on("agent_start", () => (uses = 0));
	pi.on("session_start", () => {
		if (settings().advisorEnabled) pi.setActiveTools([...new Set([...pi.getActiveTools(), "advisor"])]);
	});

	// Per operator prompt: tool calls made, whether the advisor was consulted, whether we already asked.
	let calls = 0, consulted = false, asked = false;
	pi.on("input", (event) => {
		if (event.source !== "extension") (calls = 0), (consulted = false), (asked = false);
	});
	pi.on("tool_result", (event) => {
		if (event.toolName === "advisor") consulted = true;
		else calls++;
	});
	pi.on("agent_settled", (event) => {
		if (event.aborted || asked || consulted || calls < REVIEW_AFTER_CALLS || !settings().advisorEnabled) return;
		asked = true;
		pi.sendUserMessage(REVIEW);
	});

	pi.registerTool({
		name: "advisor",
		label: "advisor",
		defaultActive: false,
		description: `Ask a reviewer model with a fresh view for a verdict (On track / Course-correct / Not done yet) and at most 5 next steps, based on your transcript. Max ${MAX_USES_PER_RUN} uses per run.`,
		parameters: Type.Object({
			question: Type.String({ description: "What you want judged: your plan, why you are stuck, or whether you are done" }),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (uses >= MAX_USES_PER_RUN) return { content: [{ type: "text", text: "Advisor budget for this run is used up; continue on your own." }] };
			const { advisorEnabled, advisorModel } = settings();
			if (!advisorEnabled) throw new Error("advisor: disabled in settings.json");
			const slash = advisorModel ? advisorModel.indexOf("/") : -1;
			const model = advisorModel ? ctx.modelRegistry.find(advisorModel.slice(0, slash), advisorModel.slice(slash + 1)) : ctx.model;
			if (!model) throw new Error(`advisor: model ${advisorModel ?? "(session)"} not found`);
			const name = `${model.provider}/${model.id}`;
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) throw new Error(`advisor: no credentials for ${name}`);
			uses++;

			const messages = ctx.sessionManager.getBranch().flatMap((e) => (e.type === "message" ? [e.message] : []));
			const transcript = [messages[0], ...messages.slice(1).slice(-RECENT_MESSAGES)].filter(Boolean).map(render).join("\n\n");
			const prompt = `# Agent system prompt\n${clip(ctx.getSystemPrompt(), MAX_PROMPT)}\n\n# Transcript (first message and most recent)\n${transcript}\n\n# The agent asks\n${params.question}`;

			const res = await completeSimple(
				model,
				{ systemPrompt: SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
				{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: Math.min(16000, model.maxTokens || 16000), reasoning: model.reasoning ? "high" : undefined, signal },
			);
			const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
			if (!text) throw new Error(`advisor: empty response (${res.errorMessage ?? res.stopReason})`);
			return { content: [{ type: "text", text }], details: { model: name, input: res.usage?.input, output: res.usage?.output } };
		},
	});
}
