# The Cloud Run services and the tick.

locals {
  # the agents: private (the server calls them with an ID token); one instance each, as their run
  # stores are local files. cpu_idle = false where a run continues in the background after the 202.
  agents = {
    investigation = { cpu_idle = false, env = { DATA_AUTH = "id_token" } }
    monitor       = { cpu_idle = false, env = {} }
    setup         = { cpu_idle = true, env = { SERVER_AUTH = "id_token" } }
  }
  agent_env = {
    GOOGLE_GENAI_USE_ENTERPRISE = "true"
    GOOGLE_GENAI_USE_VERTEXAI   = "true"
    GOOGLE_CLOUD_PROJECT        = var.project_id
    GOOGLE_CLOUD_LOCATION       = "global"
  }

  server_env = merge({
    INSTITUTION_ID        = var.institution_id
    SERVER_PUBLIC_URL     = local.server_url
    AUTH_MODE             = var.auth_mode
    RECAPTCHA_SITE_KEY    = var.recaptcha_site_key
    RECAPTCHA_HOSTNAMES   = local.server_hostname
    AUTH_LOCAL_AGENTS     = "false"
    PROTOTYPE_RESET       = tostring(var.prototype_reset)
    INTERNAL_AUTH         = "id_token"
    INTERNAL_CALLERS      = join(",", local.internal_callers)
    INVESTIGATION_URL     = google_cloud_run_v2_service.agent["investigation"].uri
    INVESTIGATION_AUTH    = "id_token"
    MONITOR_URL           = google_cloud_run_v2_service.agent["monitor"].uri
    MONITOR_AUTH          = "id_token"
    ASSISTANT_BACKEND     = "http"
    ASSISTANT_URL         = google_cloud_run_v2_service.agent["setup"].uri
    ASSISTANT_AUTH        = "id_token"
    RADAR_URL             = var.radar_url
    RADAR_AUTH            = "id_token"
    RADAR_DAILY_BYTES_CAP = tostring(var.radar_daily_bytes_cap)
    DB_POOL_MAX           = "5" # db-f1-micro allows about 25 connections in all
  }, var.server_env)

  sql_volume = google_sql_database_instance.db.connection_name
}

resource "google_cloud_run_v2_service" "agent" {
  for_each            = local.agents
  name                = "amiri-${each.key}"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL" # reachable, but only callers with run.invoker get in
  deletion_protection = false

  template {
    service_account = google_service_account.sa[each.key].email
    timeout         = "300s"
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = local.images[each.key]
      ports {
        container_port = 8080
      }
      resources {
        limits            = { cpu = "1", memory = "1Gi" }
        cpu_idle          = each.value.cpu_idle
        startup_cpu_boost = true
      }
      dynamic "env" {
        for_each = merge(local.agent_env, each.value.env)
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = var.image_tag != ""
      error_message = "No image_tag yet: run infra/scripts/build.sh first (it writes image.auto.tfvars)."
    }
  }

  depends_on = [google_project_iam_member.grants]
}

resource "google_cloud_run_v2_service_iam_member" "server_calls_agents" {
  for_each = google_cloud_run_v2_service.agent
  name     = each.value.name
  location = each.value.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.sa["server"].email}"
}

resource "google_cloud_run_v2_service" "server" {
  name                = local.server_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.sa["server"].email
    timeout         = "600s" # a setup-agent turn takes up to 120 s; the tick waits on the agents' answers
    scaling {
      min_instance_count = 0
      max_instance_count = var.server_max_instances
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.sql_volume]
      }
    }
    containers {
      image = local.images["server"]
      ports {
        container_port = 8080
      }
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      dynamic "env" {
        for_each = local.server_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = google_secret_manager_secret.s
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = var.image_tag != ""
      error_message = "No image_tag yet: run infra/scripts/build.sh first (it writes image.auto.tfvars)."
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.server_reads, google_project_iam_member.grants]
}

# the web app is public; sign-in (AUTH_MODE=prototype) guards everything behind it
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.server.name
  location = google_cloud_run_v2_service.server.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ------------------------------------------------------------------ the tick

resource "google_cloud_scheduler_job" "tick" {
  name             = "amiri-tick"
  region           = var.region
  description      = "The work tick: market series, monitors, Radar, investigations, alerts"
  schedule         = "*/15 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "600s"
  paused           = !var.awake # the switch: no ticks while the database is stopped

  retry_config {
    retry_count = 0 # the next tick picks up what this one missed
  }

  http_target {
    http_method = "POST"
    uri         = "${local.server_url}/internal/tick"
    oidc_token {
      service_account_email = google_service_account.sa["scheduler"].email
      audience              = local.server_url
    }
  }

  depends_on = [google_project_service.apis, google_cloud_run_v2_service.server]
}
