---
name: labs
description: How to work on a lab or test environment the operator set up (any target you were given notes, scope or credentials for, e.g. a folder under /usr/local/shared/labs/ or /usr/local/src/). Use at the start of any task on a lab.
---

# Labs

A lab is whatever the operator describes: in the task, or in files they point to (often a folder under `/usr/local/shared/labs/<name>/` or a read-only mount under `/usr/local/src/`). Any layout works; these names are recognised if present:

| File | Contents |
|---|---|
| `LAB.md` (or a README, notes) | target, version, endpoints, accounts, how to observe state |
| `scope.md` | what you may test and how |
| `credentials/` | accounts and keys for the lab |
| `SHA256SUMS` | checksums of the files above |

1. Read the lab description and the scope. If there is no scope, ask the operator for it and stop there: until you have it, do nothing beyond reading the lab's files and step 3 for endpoints the description names with host and port. Do not scan or guess ports.
2. If a `SHA256SUMS` file exists, check it: `cd <lab dir> && sha256sum -c SHA256SUMS`. If a check fails, stop and tell the operator.
3. Check that the named endpoints you need are reachable (one connection each). If one is blocked, report the exact host, port and protocol for the operator's allowlist.
4. Record the lab's name, version and conditions (account, configuration) in every evidence file.
5. You cannot reset, rebuild or reconfigure a lab. When it needs that, or its description is wrong, stop and tell the operator what is needed and why.
