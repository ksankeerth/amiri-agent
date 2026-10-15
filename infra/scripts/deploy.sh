#!/usr/bin/env bash
# Plans the change, shows it, and applies it only when you say yes.
#
#     infra/scripts/deploy.sh base   # first time: APIs, registry, accounts, secrets, the database (no services yet)
#     infra/scripts/deploy.sh        # everything (needs the images: build.sh, and the secrets: secrets.sh)
source "$(dirname "$0")/common.sh"
need terraform "https://developer.hashicorp.com/terraform/install"

[ -f "$TF/backend.hcl" ] || { echo "Run infra/scripts/bootstrap.sh first." >&2; exit 1; }

TARGETS=()
if [ "${1:-}" = "base" ]; then
  # what the services need to exist first; secrets.sh fills the secrets, build.sh pushes the images
  for r in google_project_service.apis google_artifact_registry_repository.amiri google_secret_manager_secret.s \
           google_secret_manager_secret_iam_member.server_reads google_sql_database_instance.db google_sql_database.amiri \
           google_service_account.sa google_project_iam_member.grants google_service_account_iam_member.operator_as_ops \
           google_billing_budget.budget; do
    TARGETS+=("-target=$r")
  done
  echo "Base only (Terraform warns that -target is for exceptional use: this is one)."
fi

PLAN="$TF/tfplan"
terraform -chdir="$TF" plan -input=false -out="$PLAN" ${TARGETS[@]+"${TARGETS[@]}"}
echo
if confirm "Apply this plan?"; then
  terraform -chdir="$TF" apply -input=false "$PLAN"
  rm -f "$PLAN"
  echo
  terraform -chdir="$TF" output
else
  rm -f "$PLAN"
  echo "Nothing changed."
fi
