#!/usr/bin/env bash
# Runs the page checks under several host timezones — the models are pinned to UTC+8, so the
# result must not move when the machine's zone does. Run: bash run-checks.sh
set -e
cd "$(dirname "$0")"
for tz in UTC America/New_York Asia/Kolkata Pacific/Auckland; do
  printf '%-20s ' "$tz"
  TZ="$tz" node check-pages.mjs
done
echo "PASS — all pages identical across 4 host timezones"
