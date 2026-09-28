#!/usr/bin/env bash
# Deprecates every @gixcopilot/* version below the given one (default 0.2.0), e.g. after a
# partial release. npm requires two-factor auth for this; the script asks for a one-time code
# and asks again whenever the code expires. Idempotent: safe to re-run.
#   bash tools/deprecate-old-versions.sh [version]
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

otp=""
for name in "${names[@]}"; do
  while true; do
    [ -n "$otp" ] || read -r -p "npm one-time code: " otp
    if out=$(npm deprecate "$name@<$below" "$message" --otp "$otp" 2>&1); then
      echo "deprecated $name@<$below"
      break
    elif grep -q "EOTP\|one-time pass" <<<"$out"; then
      echo "Code rejected or expired."
      otp=""
    else
      echo "FAILED $name: $(grep -m1 'npm error' <<<"$out")"
      break
    fi
  done
done
