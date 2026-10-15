# Amiri Agent on Google Cloud: one project per institution (or per teammate testing it).
#
#   Cloud Run       amiri-server (web app + API), amiri-investigation, amiri-monitor, amiri-setup
#   Cloud SQL       Postgres 16, the smallest size; stopped when `awake = false`
#   Scheduler       the tick every 15 minutes (paused when `awake = false`)
#   Secret Manager  containers only: infra/scripts/secrets.sh adds the values
#   Artifact Reg.   the images (infra/scripts/build.sh builds them with Cloud Build)
#
# infra/README.md is the step-by-step guide.

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  # Cloud Run's deterministic URL (https://SERVICE-PROJECT_NUMBER.REGION.run.app) is known before the
  # service exists, so the server's own URL, the reCAPTCHA domain and the tick's audience need no second pass.
  server_name     = "amiri-server"
  server_hostname = "${local.server_name}-${data.google_project.this.number}.${var.region}.run.app"
  server_url      = "https://${local.server_hostname}"

  registry = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.amiri.repository_id}"
  images   = { for k in ["server", "investigation", "monitor", "setup"] : k => "${local.registry}/${k}:${var.image_tag}" }

  apis = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudscheduler.googleapis.com",
    "aiplatform.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "cloudtrace.googleapis.com",
    "billingbudgets.googleapis.com",
    "bigquery.googleapis.com", # Radar (GDELT), once its agent is connected
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# ------------------------------------------------------------------ images

resource "google_artifact_registry_repository" "amiri" {
  repository_id = "amiri"
  location      = var.region
  format        = "DOCKER"
  description   = "Amiri Agent images"

  # the free tier is 0.5 GB: keep the last few images of each service
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }
  cleanup_policies {
    id     = "delete-older"
    action = "DELETE"
    condition {
      older_than = "604800s" # a week; the three most recent are kept anyway
    }
  }

  depends_on = [google_project_service.apis]
}

# ------------------------------------------------------------------ secrets (containers only)

locals {
  # name -> who reads it. Values: infra/scripts/secrets.sh (never in Terraform or its state).
  secrets = {
    DATABASE_URL       = "the server's connection string (the script makes the database user)"
    SESSION_SECRET     = "signs the cookie a passed bot check sets (the script generates it)"
    RECAPTCHA_SECRET   = "the reCAPTCHA key's secret key"
    TWELVEDATA_API_KEY = "Twelve Data, for the market series"
  }
}

resource "google_secret_manager_secret" "s" {
  for_each  = local.secrets
  secret_id = each.key
  labels    = { app = "amiri-agent" }
  annotations = {
    purpose = each.value
  }
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "server_reads" {
  for_each  = google_secret_manager_secret.s
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.sa["server"].email}"
}

# ------------------------------------------------------------------ the database

resource "google_sql_database_instance" "db" {
  name                = "amiri-db"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.protect_database

  settings {
    tier              = var.sql_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.sql_disk_gb
    disk_autoresize   = true

    # the switch: NEVER stops the instance (no compute charge; storage and the IP still are)
    activation_policy           = var.awake ? "ALWAYS" : "NEVER"
    deletion_protection_enabled = var.protect_database

    ip_configuration {
      # Cloud Run connects through the Cloud SQL connector (IAM-checked, encrypted); no network is allowed in
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled    = true
      start_time = "20:00" # UTC
      backup_retention_settings {
        retained_backups = 7
      }
    }

    user_labels = { app = "amiri-agent" }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "amiri" {
  name     = "amiri"
  instance = google_sql_database_instance.db.name
}
# The database user `amiri` is made by infra/scripts/secrets.sh, so its password never enters the state.

# ------------------------------------------------------------------ a cost alert

resource "google_billing_budget" "budget" {
  count           = var.billing_account_id == "" ? 0 : 1
  billing_account = var.billing_account_id
  display_name    = "Amiri Agent (${var.project_id})"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }
  amount {
    specified_amount {
      units = tostring(var.budget_amount)
    }
  }
  # the billing account's admins get the emails
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.9 }
  threshold_rules { threshold_percent = 1.0 }

  depends_on = [google_project_service.apis]
}
