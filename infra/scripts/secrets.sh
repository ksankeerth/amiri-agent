#!/usr/bin/env bash
# Puts the secret values in Secret Manager, never in Terraform, its state, or the repository.
#
#     infra/scripts/secrets.sh                  # every secret that has no value yet
#     infra/scripts/secrets.sh RECAPTCHA_SECRET # just this one (a new value replaces the old)
#     infra/scripts/secrets.sh --all            # every secret, again
#
# DATABASE_URL: makes (or resets) the database user `amiri` with a new random password.
# SESSION_SECRET, DATA_SECRET_KEY: generated.
# The others are prompted for, without echo. Old versions are destroyed (the free tier has 6 active versions).
# A running service reads a new value when it next starts: deploy.sh, or wait for it to scale to zero.
source "$(dirname "$0")/common.sh"
need gcloud "https://cloud.google.com/sdk/docs/install"
need openssl "for random values"

PROJECT="$(tfvar project_id)"
ALL=(DATABASE_URL SESSION_SECRET DATA_SECRET_KEY RECAPTCHA_SECRET TWELVEDATA_API_KEY)

has_value() { [ -n "$(gcloud secrets versions list "$1" --project "$PROJECT" --filter=state=ENABLED --limit=1 --format='value(name)' 2>/dev/null)" ]; }

put() { # name value
  printf '%s' "$2" | gcloud secrets versions add "$1" --project "$PROJECT" --data-file=- --format='value(name)' >/dev/null
  # keep only the newest version
  local newest=1 v
  for v in $(gcloud secrets versions list "$1" --project "$PROJECT" --filter='state!=DESTROYED' --sort-by=~createTime --format='value(name)'); do
    if [ $newest = 1 ]; then newest=0; continue; fi
    gcloud secrets versions destroy "$v" --secret "$1" --project "$PROJECT" --quiet >/dev/null
  done
  echo "  $1: set"
}

ask() { # prompt -> REPLY (not echoed)
  local v
  read -r -s -p "$1: " v; echo
  [ -n "$v" ] || { echo "  empty: skipped"; return 1; }
  REPLY="$v"
}

set_one() {
  case "$1" in
    DATABASE_URL)
      local inst conn pw
      inst="$(out sql_instance)"; conn="$(out sql_connection_name)"
      pw="$(openssl rand -hex 24)"
      if gcloud sql users list --instance "$inst" --project "$PROJECT" --format='value(name)' | grep -qx amiri; then
        gcloud sql users set-password amiri --instance "$inst" --project "$PROJECT" --password "$pw" >/dev/null
      else
        gcloud sql users create amiri --instance "$inst" --project "$PROJECT" --password "$pw" >/dev/null
      fi
      put DATABASE_URL "postgresql://amiri:${pw}@/amiri?host=/cloudsql/${conn}" ;;
    SESSION_SECRET)
      put SESSION_SECRET "$(openssl rand -base64 48 | tr -d '\n')" ;;
    DATA_SECRET_KEY)
      put DATA_SECRET_KEY "$(openssl rand -base64 48 | tr -d '\n')" ;;
    RECAPTCHA_SECRET)
      echo "  The reCAPTCHA v2 checkbox key for $(out server_hostname): https://www.google.com/recaptcha/admin"
      ask "RECAPTCHA_SECRET (the key's secret key)" && put RECAPTCHA_SECRET "$REPLY" ;;
    TWELVEDATA_API_KEY)
      ask "TWELVEDATA_API_KEY (https://twelvedata.com, free plan)" && put TWELVEDATA_API_KEY "$REPLY" ;;
    *) echo "Unknown secret $1; one of: ${ALL[*]}" >&2; exit 1 ;;
  esac
}

if [ "${1:-}" = "--all" ]; then
  for s in "${ALL[@]}"; do set_one "$s"; done
elif [ -n "${1:-}" ]; then
  set_one "$1"
else
  for s in "${ALL[@]}"; do
    if has_value "$s"; then echo "  $s: has a value (infra/scripts/secrets.sh $s to replace it)"; else set_one "$s"; fi
  done
fi
