# Shared by the scripts in this folder: paths, and reading terraform.tfvars and the outputs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF="$ROOT/infra/terraform"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Needs $1 ($2)." >&2; exit 1; }; }

# a value from terraform.tfvars: tfvar project_id
tfvar() {
  [ -f "$TF/terraform.tfvars" ] || { echo "No infra/terraform/terraform.tfvars yet: copy terraform.tfvars.example and fill it in." >&2; exit 1; }
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"\(.*\)\".*/\1/p" "$TF/terraform.tfvars" | head -1
}

out() { terraform -chdir="$TF" output -raw "$1"; }

confirm() {
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]]
}
