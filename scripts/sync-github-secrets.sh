#!/usr/bin/env bash

set -euo pipefail

REPO="${1:-Einfeld686/calendar-notifier}"
REQUIRED_KEYS=(
  RENDER_DEPLOY_HOOK_URL
  DATABASE_URL
  S3_ENDPOINT
  S3_REGION
  S3_BUCKET
  S3_ACCESS_KEY_ID
  S3_SECRET_ACCESS_KEY
  BASE_URL
  ADMIN_USER
  ADMIN_PASSWORD
  REVIEWER_LABEL
)

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is required. Install it first." >&2
  exit 1
fi

if [ -z "${GH_TOKEN:-}" ]; then
  GH_TOKEN="$(
    printf 'protocol=https\nhost=github.com\n\n' \
      | git credential fill \
      | awk -F= '/^password=/{print $2}'
  )"
  export GH_TOKEN
fi

if [ -z "${GH_TOKEN:-}" ]; then
  echo "GH_TOKEN is not available and no GitHub credential was found." >&2
  exit 1
fi

missing=()

for key in "${REQUIRED_KEYS[@]}"; do
  value="${!key:-}"
  if [ -z "$value" ]; then
    missing+=("$key")
    continue
  fi

  printf '%s' "$value" | gh secret set "$key" --repo "$REPO"
  echo "set $key"
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo
  echo "missing values:"
  for key in "${missing[@]}"; do
    echo "- $key"
  done
  exit 1
fi

echo
echo "all required secrets are configured for $REPO"
