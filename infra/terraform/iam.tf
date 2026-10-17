# One service account per service, with only what it needs.

locals {
  accounts = {
    server        = "amiri-server: web app, API, the tick"
    investigation = "amiri-investigation agent"
    monitor       = "amiri-monitor agent"
    setup         = "amiri-setup agent"
    radar         = "amiri-radar agent: reads GDELT in BigQuery"
    scheduler     = "Cloud Scheduler: calls the tick"
    build         = "Cloud Build: builds and pushes the images"
    ops           = "a person running scripts against the API, by impersonation"
  }

  project_roles = {
    server        = ["roles/cloudsql.client"]
    investigation = ["roles/aiplatform.user", "roles/cloudtrace.agent", "roles/logging.logWriter"]
    monitor       = ["roles/aiplatform.user", "roles/cloudtrace.agent", "roles/logging.logWriter"]
    setup         = ["roles/aiplatform.user", "roles/cloudtrace.agent", "roles/logging.logWriter"]
    radar         = ["roles/aiplatform.user", "roles/cloudtrace.agent", "roles/logging.logWriter"]
    build         = ["roles/artifactregistry.writer", "roles/logging.logWriter", "roles/storage.objectViewer"]
  }
  grants = merge([for sa, roles in local.project_roles : { for r in roles : "${sa} ${r}" => { sa = sa, role = r } }]...)

  # the callers the server lets in with a Google ID token (INTERNAL_CALLERS)
  internal_callers = [for k in ["scheduler", "investigation", "setup", "ops"] : google_service_account.sa[k].email]
}

resource "google_service_account" "sa" {
  for_each     = local.accounts
  account_id   = "amiri-${each.key}"
  display_name = each.value
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "grants" {
  for_each = local.grants
  project  = var.project_id
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.sa[each.value.sa].email}"
}

# Radar runs its own BigQuery jobs and lists them (its daily and monthly byte budget is the sum of what its
# labelled jobs billed). roles/bigquery.jobUser can't list jobs, so the budget check would refuse every run;
# roles/bigquery.user could also create datasets. This role is exactly the two. GDELT itself is public.
resource "google_project_iam_custom_role" "radar_bigquery" {
  role_id     = "amiriRadarBigQuery"
  title       = "Amiri Radar: run and list its own BigQuery jobs"
  permissions = ["bigquery.jobs.create", "bigquery.jobs.list"]
}

resource "google_project_iam_member" "radar_bigquery" {
  project = var.project_id
  role    = google_project_iam_custom_role.radar_bigquery.id
  member  = "serviceAccount:${google_service_account.sa["radar"].email}"
}

# you may mint ID tokens as the ops account, for scripts against the API
resource "google_service_account_iam_member" "operator_as_ops" {
  service_account_id = google_service_account.sa["ops"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.operator_email}"
}
