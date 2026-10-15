#!/usr/bin/env bash
# Once per project: a private, versioned bucket for the Terraform state, and `terraform init`.
#
#     infra/scripts/bootstrap.sh
#
# Reads project_id and region from infra/terraform/terraform.tfvars.
source "$(dirname "$0")/common.sh"
need gcloud "https://cloud.google.com/sdk/docs/install"
need terraform "https://developer.hashicorp.com/terraform/install"

PROJECT="$(tfvar project_id)"
REGION="$(tfvar region)"
BUCKET="${PROJECT}-amiri-tfstate"

echo "Project $PROJECT, region $REGION"
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com storage.googleapis.com \
  --project "$PROJECT"

if gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "State bucket gs://$BUCKET exists."
else
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "gs://$BUCKET" --versioning
  echo "Made the state bucket gs://$BUCKET (private, versioned)."
fi

cat > "$TF/backend.hcl" <<EOF
bucket = "$BUCKET"
prefix = "amiri-agent"
EOF
terraform -chdir="$TF" init -backend-config=backend.hcl
echo
echo "Next: infra/scripts/deploy.sh base"
