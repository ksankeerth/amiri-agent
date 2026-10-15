terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.20, < 8.0"
    }
  }

  # The state lives in a private, versioned bucket in your own project (infra/scripts/bootstrap.sh writes
  # backend.hcl). It holds no secret values: those are added to Secret Manager by infra/scripts/secrets.sh.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region

  # bill API calls (budgets, …) to this project, not to gcloud's own
  user_project_override = true
  billing_project       = var.project_id
}
