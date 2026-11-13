export CONTAINERS_CONF_OVERRIDE := $(CURDIR)/containers.conf
SHELL := /bin/bash

msg = printf '[\033[0;33m*\033[0m] %s\n' "$(1)"
ok  = printf '[\033[0;32m+\033[0m] Done\n'

# runsc drops the sandbox route itself, so netavark's teardown fails to delete it: harmless.
QUIET := 2> >(grep -v --line-buffered 'netavark: Netlink error: No such process' >&2)

# Entries of a pisec.conf [section], one per line, comments stripped
section = awk -v s='[$(1)]' '/^\[/ { on = ($$1 == s); next } on { sub(/\#.*/, ""); if (NF) print }' pisec.conf
PKGS   := $(shell $(call section,packages))
MOUNTS := $(shell $(call section,mount) | awk '{ sub(/^~/, ENVIRON["HOME"], $$1); d = $$2; if (d == "") { d = $$1; sub(/.*\//, "", d); d = "/usr/local/src/" d } printf "-v %s:%s:ro ", $$1, d }')
MCP    := $(if $(wildcard agent/config/mcp.json),-v $(CURDIR)/agent/config/mcp.json:/root/.pi/agent/mcp.json:ro)
RUN    := podman compose run --rm $(MOUNTS) $(MCP)

pod-build:
	@ $(call msg,Building images...)
	@ podman compose build --build-arg PKGS="$(PKGS)" >/dev/null
	@ $(ok)

pod-shell: agent/config/auth.json
	@ $(call msg,Starting pisec...)
	@ $(RUN) agent $(QUIET)

# Headless: make pod-run TASK="..." prints the agent's final answer
pod-run: agent/config/auth.json
	@ test -n "$$TASK" || { echo 'usage: make pod-run TASK="..."' >&2; exit 1; }
	@ $(RUN) -T agent pi -p "$$TASK" < /dev/null $(QUIET)

# pi keeps /login tokens here
agent/config/auth.json:
	@ umask 077; echo '{}' > $@

pod-remove:
	@ $(call msg,Removing containers and images...)
	@ podman compose down >/dev/null 2>&1
	@ podman rmi pisec pisec-gw >/dev/null
	@ $(ok)

# Apply pisec.conf [allow] and [hosts] edits live
gw-reload:
	@ $(call msg,Reloading allowlist...)
	@ podman exec -i pisec-gw gateway reload < pisec.conf
	@ $(ok)

.PHONY: pod-build pod-shell pod-run pod-remove gw-reload
