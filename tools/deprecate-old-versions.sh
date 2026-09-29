#!/usr/bin/env bash
# Deprecates every @gixcopilot/* version below the given one (default 0.2.0), e.g. after a
# partial release. Idempotent: safe to re-run.
#   bash tools/deprecate-old-versions.sh [version]
# Interactive, it asks for an npm one-time code (authenticator app) and asks again when it
# expires. With NODE_AUTH_TOKEN set (the Deprecate workflow, using the NPM_TOKEN secret, which
# bypasses 2FA) it runs without prompting and exits non-zero if any package fails.
set -uo pipefail
below="${1:-0.2.0}"
message="Partial release; please use >=$below"

echo "Finding packages with versions below $below..."
names=()
for name in $(node tools/check-npm-published.mjs --json 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const p of JSON.parse(d).packages)console.log(p.name)})'); do
  if npm view "$name" versions --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const v=[].concat(JSON.parse(d));process.exit(v.some(x=>x.localeCompare('$below',undefined,{numeric:true})<0)?0:1)})"; then
    names+=("$name")
  fi
done
echo "${#names[@]} package(s) to deprecate."

if [ -n "${NODE_AUTH_TOKEN:-}" ]; then
  failed=0
  for name in "${names[@]}"; do
    if out=$(npm deprecate "$name@<$below" "$message" 2>&1); then
      echo "deprecated $name@<$below"
    else
      echo "::error::FAILED $name: $(grep -m1 'npm error' <<<"$out")"
      failed=1
    fi
  done
  exit $failed
fi

otp=""
for name in "${names[@]}"; do
  while true; do
    while [ -z "$otp" ]; do
      read -r -p "npm one-time code (6 digits from your authenticator app): " otp
      otp="${otp//[[:space:]]/}"
    done
    if out=$(npm deprecate "$name@<$below" "$message" --otp "$otp" 2>&1); then
      echo "deprecated $name@<$below"
      break
    elif grep -qi "EOTP\|one-time pass\|E401\|E404" <<<"$out"; then
      # npm reports a missing/wrong code as EOTP, and sometimes as 401/404 on the PUT.
      echo "Code rejected or expired."
      otp=""
    else
      echo "FAILED $name: $(grep -m1 'npm error' <<<"$out")"
      break
    fi
  done
done
