# One service account per service, with only what it needs.

locals {
  accounts = {
    server        = "amiri-server: web app, API, the tick"
    investigation = "amiri-investigation agent"
    monitor       = "amiri-monitor agent"
    setup         = "amiri-setup agent"
    scheduler     = "Cloud Scheduler: calls the tick"
    build         = "Cloud Build: builds and pushes the images"
    ops           = "a person running scripts against the API, by impersonation"
  }

  project_roles = {
    server        = ["roles/cloudsql.client"]
    investigation = ["roles/aiplatform.user", "roles/cloudtrace.agent", "roles/logging.logWriter"]
    monitor       = ["roles/aiplatform.user", "roles/cloudtrace.agent", "roles/logging.logWriter"]
    setup         = ["roles/aiplatform.user", "roles/cloudtrace.agent", "roles/logging.logWriter"]
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

# you may mint ID tokens as the ops account, for scripts against the API
resource "google_service_account_iam_member" "operator_as_ops" {
  service_account_id = google_service_account.sa["ops"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "user:${var.operator_email}"
}
