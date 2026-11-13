#!/bin/sh
# Compiles pisec.conf [allow] into nftables (raw IP egress) + a squid domain ACL, and
# [hosts] into /etc/hosts. Any invalid line aborts before anything is applied (fail closed).
set -euf

CONF=/etc/pisec/pisec.conf
DOMAINS=/etc/squid/allowlist-domains.txt
LOGS=/var/log/pisec
: "${SUBNET:?SUBNET not set}"
: "${GW_IP:?GW_IP not set}"

IP_RE='([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?'
HOST_IP_RE='([0-9]{1,3}\.){3}[0-9]{1,3}'
PORT_RE='(tcp|udp)/[0-9]{1,5}(-[0-9]{1,5})?'
DOMAIN_RE='\.?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?'

matches() { printf '%s\n' "$2" | grep -Eqix "$1"; }
die() { echo "pisec.conf: line $n: $*" >&2; exit 1; }

apply() {
	rules="" domains="" hosts="" section="" n=0
	while IFS= read -r line || [ -n "$line" ]; do
		n=$((n + 1))
		set -- ${line%%#*}
		[ $# -eq 0 ] && continue
		case "$1" in
		"[allow]" | "[hosts]" | "[packages]" | "[mount]") section=$1; continue ;;
		"["*) die "unknown section '$1'" ;;
		esac
		case "$section:$#" in
		"[allow]:1")
			if matches "$IP_RE" "$1"; then
				rules="$rules
		ip daddr $1 log group 1 accept"
			elif matches "$DOMAIN_RE" "$1"; then
				domains="$domains$1
"
			else
				die "invalid entry '$1'"
			fi
			;;
		"[allow]:2")
			matches "$IP_RE" "$1" || die "invalid IP '$1'"
			matches "$PORT_RE" "$2" || die "invalid port spec '$2' (want tcp/N or udp/N-M)"
			rules="$rules
		ip daddr $1 ${2%%/*} dport ${2#*/} log group 1 accept"
			;;
		"[hosts]:2")
			matches "$DOMAIN_RE" "$1" || die "invalid host name '$1'"
			matches "$HOST_IP_RE" "$2" || die "invalid host IP '$2'"
			hosts="$hosts$2 $1
"
			;;
		"[allow]:"* | "[hosts]:"*) die "wrong number of fields" ;;
		"[packages]:"* | "[mount]:"*) ;;
		*) die "entry outside a section" ;;
		esac
	done < "$CONF"

	# nft -f is atomic: on error the previous ruleset stays in place.
	nft -f - <<EOF
flush ruleset
table inet pisec {
	chain input {
		type filter hook input priority 0; policy accept;
		ip saddr $SUBNET tcp dport { 3128, 4000 } accept
		ip saddr $SUBNET drop
	}
	chain forward {
		type filter hook forward priority 0; policy drop;
		ct state established,related accept
		ip saddr != $SUBNET drop$rules
		limit rate 20/second log group 2
	}
}
table ip nat {
	chain postrouting {
		type nat hook postrouting priority srcnat;
		ip saddr $SUBNET ip daddr != $SUBNET masquerade
	}
}
EOF
	printf '%s' "$domains" > "$DOMAINS"
	# /etc/hosts is a Podman bind mount: rewrite it in place from the original copy.
	[ -f /etc/hosts.orig ] || cp /etc/hosts /etc/hosts.orig
	{ cat /etc/hosts.orig; printf '%s' "$hosts"; } > /etc/hosts
}

# nflog group -> "<epoch> NET <verdict> <src> <dst[:port]> <proto>" (group 1: new allowed connections, 2: dropped)
netlog() {
	tcpdump -n -tt -l -i "nflog:$1" 2>/dev/null | awk -v verdict="$2" '{
		proto = $6 == "Flags" ? "tcp" : tolower($6); sub(/,$/, "", proto)
		src = $3; dst = $5; sub(/:$/, "", dst)
		if (proto == "tcp" || proto == "udp") { sub(/\.[0-9]+$/, "", src); n = match(dst, /\.[0-9]+$/); if (n) dst = substr(dst, 1, n - 1) ":" substr(dst, n + 1) }
		printf "%.3f NET %s %s %s %s\n", $1, verdict, src, dst, proto; fflush()
	}' >> "$LOGS/net.log"
}

start_logging() {
	mkdir -p "$LOGS"
	touch "$LOGS/proxy.log" "$LOGS/tools.log" "$LOGS/net.log"
	chown squid:squid "$LOGS/proxy.log"
	# Tool calls from the agent's audit extension, one line per connection write.
	socat -u TCP-LISTEN:4000,fork,reuseaddr "OPEN:$LOGS/tools.log,append" &
	netlog 1 ALLOW &
	netlog 2 DROP &
}

case "${1:-}" in
reload)
	# Read from stdin: a file bind mount keeps showing the old inode after an editor replaces the file.
	CONF=/dev/stdin
	apply
	kill -HUP 1
	;;
*)
	apply
	start_logging
	# The sandbox route also lands here: prefer the default network for egress, without
	# deleting Podman's route (Podman fails to restart the container if it is missing).
	ip route add $(ip -4 route show default | grep -v 'dev sandbox' | head -1 | sed 's/ metric [0-9]*//') metric 1
	# Claim the agent's next hop only now, so traffic can't pass before the rules exist.
	ip addr add "$GW_IP/${SUBNET#*/}" dev sandbox
	exec squid -N -d 1 -f /etc/squid/squid.conf
	;;
esac
