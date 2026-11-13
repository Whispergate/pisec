---
name: research-threads
description: Record and resume investigations in /usr/local/shared/threads, and write the final report. Use when starting or continuing an engagement, when a testable hypothesis appears, when evidence supports, narrows or rejects a claim, when an investigation gets blocked, and when the work is done.
---

# Research threads

A thread is one testable question (a hypothesis) plus the evidence behind its current assessment. Threads live in `/usr/local/shared/threads` so they survive restarts, context compaction and new sessions.

```
threads/
├── index.md                  # one line per thread; read this first
└── T-001-<slug>/
    ├── index.md              # question, assessment, evidence links, next action
    └── evidence/
        └── E-001.md          # one atomic check
```

## Resume

1. Read `threads/index.md`. Open a thread's `index.md` only when it is relevant to the current task; open evidence files only when you need the details.
2. Before testing anything, check whether a thread already covers it. Do not repeat a check whose evidence already exists unless the conditions changed (target version, configuration, account, payload).

## Open a thread

Open one when you have a specific, testable claim, e.g. "As viewer `alice`, `DELETE /api/reports/42` (owned by `bob`) deletes the report". Use the next free id, add it to `threads/index.md`, and create its `index.md`:

```markdown
---
id: T-001
status: active          # active | blocked | closed
---
# <short title>

## Question
<the testable claim, with actor, target and action>

## Current assessment
<what the evidence shows so far, and what it does not establish>

## Evidence
- [E-001: <title>](evidence/E-001.md)

## Next action
<one concrete next step>

## Reopen if
<closed threads only: what new information would reopen it>
```

Index line format (`threads/index.md`):

```markdown
- [T-001](T-001-viewer-delete/index.md) active: viewer delete of another user's report returned 403; other delete paths untested
```

## Record evidence

Write one evidence file per atomic check: the minimal request or command that answers one question under stated conditions. Do not save every attempt. When a run of attempts produces a result, reduce it to the one request that matters, re-run it once under the same conditions, and record that.

```markdown
---
id: E-001
thread: T-001
date: <UTC timestamp>
---
# <what was checked>

## Conditions
- Target: <host/IP, version or revision, configuration>
- Actor: <account / role / unauthenticated>
- Preconditions: <state before the check>

## Command or request
<exact command or raw request; redact secrets>

## Observed output
<trimmed to the lines that matter; keep the raw output in a file next to it if long>

## State check
<separate check of the resulting state, e.g. the object still exists>
```

Keep observations in evidence files. Interpretations belong in the thread's `Current assessment`, and untested ideas in `Next action` or a new thread.

## Update

Update the thread `index.md` and its line in `threads/index.md` when the assessment, status or next action changes, not after every command.

- **Supported**: the evidence shows the claim under the stated conditions. Say which conditions remain untested.
- **Narrowed**: the claim holds only under narrower conditions. Rewrite the question or open a new thread.
- **Rejected**: the evidence contradicts it under the tested conditions. Close it with a `Reopen if` line.
- **Blocked**: record the blocker (e.g. destination not allowlisted, failed setup), the open question and the next permitted action, set `status: blocked`, and tell the operator.

## Finish

When the task is done, or the operator asks to wrap up:

1. Bring every thread to a final state: `closed` (supported, narrowed or rejected, with a `Reopen if` line) or `blocked` (with the blocker and next permitted action). Update `threads/index.md` to match.
2. Write `threads/REPORT.md`. Every claim in it links the thread and evidence behind it; nothing appears in the report that is not in a thread.

```markdown
# Research report: <engagement or lab name>
- Date: <UTC>
- Target: <name, version or revision from the lab description>
- Scope: <scope.md or the operator's task>

## Summary
<3-5 sentences: what was investigated and what the evidence shows>

## Supported
| Thread | Claim | Conditions | Evidence |
|---|---|---|---|
| [T-001](T-001-.../index.md) | <claim> | <actor, version, config> | [E-002](T-001-.../evidence/E-002.md) |

## Rejected or narrowed
<thread, what was disproved or how the claim narrowed, evidence>

## Blocked or open
<thread, blocker or open question, next permitted action>

## Limits
<what the evidence does not establish: untested conditions, versions, paths>
```

3. Tell the operator the report is ready and give its path. Do not restate it in chat.
