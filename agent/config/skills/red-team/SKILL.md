---
name: red-team
description: Rules for engagements against live targets (networks, hosts, web apps, cloud, AD). Use before any reconnaissance, scanning, exploitation or credential use against systems outside the container.
---

# Red-team engagements

1. **Scope first.** Read the scope (task text or `scope.md`): targets, allowed techniques, time windows, limits. Anything not listed is out of scope; when unsure, ask. Write the scope you are working under at the top of your notes.
2. **Passive before active.** Prefer passive and non-destructive techniques (public sources, banners, configuration review) before active scanning, and active scanning before exploitation.
3. **Announce high impact.** Before exploitation attempts, credential attacks (spraying, cracking online), denial-of-service-prone checks or anything that writes to a target, state what you will run, against what, and the expected impact. Do not run it until the scope clearly allows it.
4. **Stay quiet and bounded.** Rate-limit scans, bound every network command with a timeout, and never run unbounded brute force.
5. **Leave no mess.** Track every change you make on a target (uploaded files, created accounts, modified settings) in your notes and report it at the end, with how to undo it.
6. **Tooling.** Say what tooling you installed and where. Install only from allowlisted registries; if one is blocked, report it rather than working around it.
7. **Loot.** Keep credentials, keys and captured data under `/usr/local/shared/loot/`, never in reports verbatim: reference them by path and redact secrets in any summary.
