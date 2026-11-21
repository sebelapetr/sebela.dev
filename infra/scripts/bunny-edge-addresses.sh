#!/bin/sh
# The addresses nginx trusts to name the visitor behind Bunny CDN (infra/README.md, "The visitor's
# address behind Bunny CDN"): one `set_real_ip_from` line per edge address of Bunny's published
# IPv4 and IPv6 lists, written to the file the site's server block includes, then `nginx -t` and a
# reload. Run by root (it writes into the nginx configuration and reloads nginx), daily from cron.
#
#   bunny-edge-addresses.sh
#
# Environment:
#   BUNNY_EDGE_OUTPUT   the file to write; default /etc/nginx/bunny-edge-addresses.conf
#
# Only bare IPv4/IPv6 addresses are kept, so an answer cannot inject other nginx directives. A
# failed download, a short list or a configuration nginx rejects keeps the previous file and does
# not reload; the script then exits non-zero for the cron log.
set -eu

out="${BUNNY_EDGE_OUTPUT:-/etc/nginx/bunny-edge-addresses.conf}"
minimum=100
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

# The IPv4 list is plain text with CRLF line ends; the IPv6 list is a JSON array of strings.
curl -fsS --max-time 30 https://bunnycdn.com/api/system/edgeserverlist/plain >"$dir/v4"
curl -fsS --max-time 30 -H 'Accept: application/json' \
  https://bunnycdn.com/api/system/edgeserverlist/ipv6 >"$dir/v6"

{
  tr -d '\r' <"$dir/v4"
  echo
  tr -d '[]" \r' <"$dir/v6" | tr ',' '\n'
} | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$|^[0-9a-fA-F:]*:[0-9a-fA-F:]+$' | sort -u \
  | sed 's/.*/set_real_ip_from &;/' >"$dir/list"

count="$(wc -l <"$dir/list" | tr -d ' ')"
if [ "$count" -lt "$minimum" ]; then
  echo "bunny-edge-addresses: the edge list is too short ($count addresses); kept the previous file" >&2
  exit 1
fi

if [ -f "$out" ]; then cp -p "$out" "$dir/previous"; fi
install -m 644 "$dir/list" "$out"
if ! nginx -t -q; then
  if [ -f "$dir/previous" ]; then cp -p "$dir/previous" "$out"; else rm -f "$out"; fi
  echo "bunny-edge-addresses: nginx rejected the new list; restored the previous file" >&2
  exit 1
fi
systemctl reload nginx
echo "bunny-edge-addresses: $count edge addresses"
