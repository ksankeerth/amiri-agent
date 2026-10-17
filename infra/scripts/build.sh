#!/usr/bin/env bash
# Builds the five images with Cloud Build (in your project; no Docker needed here) and records their tag.
#
#     infra/scripts/build.sh
#
# The tag is the git commit (with -dirty when there are uncommitted changes, plus the time), written to
# infra/terraform/image.auto.tfvars, so the next deploy.sh rolls every service to these images.
source "$(dirname "$0")/common.sh"
need gcloud "https://cloud.google.com/sdk/docs/install"

PROJECT="$(tfvar project_id)"
REGION="$(tfvar region)"
REGISTRY="$(out registry)"
BUILDER="$(out build_service_account)"

TAG="$(git -C "$ROOT" rev-parse --short HEAD)"
if [ -n "$(git -C "$ROOT" status --porcelain -- server web agents infra)" ]; then
  TAG="$TAG-dirty-$(date -u +%Y%m%d%H%M)"
fi

echo "Building $TAG into $REGISTRY"
gcloud builds submit "$ROOT" --project "$PROJECT" --region "$REGION" --config "$ROOT/infra/cloudbuild.yaml" \
  --service-account "projects/$PROJECT/serviceAccounts/$BUILDER" \
  --substitutions "_REGISTRY=$REGISTRY,_TAG=$TAG"

echo "image_tag = \"$TAG\"" > "$TF/image.auto.tfvars"
echo
echo "Built. Next: infra/scripts/deploy.sh"
