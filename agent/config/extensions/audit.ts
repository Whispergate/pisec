/**
 * Audit: sends every tool call and its outcome to the gateway, which appends
 * them to logs/tools.log on the host, out of the agent's reach. Calls are sent
 * before they run, so even a call that disrupts the session is recorded.
 * Fire-and-forget: tools never wait on (or fail because of) the audit log.
 */

import { createConnection } from "node:net";

const MAX_ARGS = 2000;

export default function (pi) {
	const [host, port] = (process.env.PISEC_AUDIT ?? "").split(":");
	if (!host || !port) return;
	const agent = process.env.PISEC_SUBAGENT ? "sub" : "main";

	let sock = null;
	const send = (record) => {
		if (!sock || sock.destroyed) {
			sock = createConnection({ host, port: Number(port) });
			sock.on("error", () => sock.destroy());
			sock.unref();
		}
		sock.write(`${(Date.now() / 1000).toFixed(3)} TOOL ${JSON.stringify({ agent, ...record })}\n`);
	};

	const summarize = (args) => {
		if (args && typeof args.command === "string") return args.command;
		if (args && typeof args.path === "string") return args.path;
		return JSON.stringify(args ?? {});
	};

	pi.on("tool_execution_start", (event) => {
		send({ ev: "call", id: event.toolCallId, tool: event.toolName, args: summarize(event.args).slice(0, MAX_ARGS) });
	});

	pi.on("tool_execution_end", (event) => {
		send({ ev: "end", id: event.toolCallId, tool: event.toolName, ok: !event.isError, ms: event.durationMs ?? 0 });
	});
}
