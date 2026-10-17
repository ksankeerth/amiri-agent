# Set these in terraform.tfvars (copy terraform.tfvars.example). Secrets are never variables: see
# infra/scripts/secrets.sh.

variable "project_id" {
  description = "Your Google Cloud project (billing linked)."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Cloud SQL, Artifact Registry and Cloud Scheduler, e.g. asia-south1."
  type        = string
}

variable "operator_email" {
  description = "Your Google account: may act as the ops service account to call the server's API from scripts."
  type        = string
}

# ------------------------------------------------------------------ the switch

variable "awake" {
  description = "true: the database runs and the tick is scheduled. false: the database is stopped and the tick paused (storage and its IP are still charged). Set by infra/scripts/awake.sh."
  type        = bool
  default     = true
}

# ------------------------------------------------------------------ images

variable "image_tag" {
  description = "The image tag every service runs (infra/scripts/build.sh writes it to image.auto.tfvars)."
  type        = string
  default     = ""
}

# ------------------------------------------------------------------ the bot check and the app

variable "auth_mode" {
  description = "prototype: no login, a reCAPTCHA box to tick in front of everything (a public URL), to keep bots out. off: no check."
  type        = string
  default     = "prototype"
  validation {
    condition     = contains(["prototype", "off"], var.auth_mode)
    error_message = "auth_mode is prototype or off."
  }
}

variable "recaptcha_site_key" {
  description = "The reCAPTCHA v2 checkbox site key for the server's hostname (not a secret; the secret key goes to Secret Manager)."
  type        = string
  default     = ""
}

variable "prototype_reset" {
  description = "Allow the prototype reset in the app. Keep false on a public URL."
  type        = bool
  default     = false
}

variable "metrics_validation" {
  description = "Allow checking events against the institution's own data. The Platform Admin still switches it on in the app (Data connections), after approving a connection."
  type        = bool
  default     = true
}

variable "institution_id" {
  description = "The institution this installation serves."
  type        = string
  default     = "serendib-bank"
}

variable "radar_url" {
  description = "Another Radar agent's URL, to use instead of the one deployed here (amiri-radar). Empty: the deployed one."
  type        = string
  default     = ""
}

variable "radar_daily_bytes_cap" {
  description = "BigQuery bytes Radar may scan a day (a cost guard). The free tier is 1 TiB a month (about 34 GB a day); a run reads about 0.9 GB (the daily run and up to 5 Check nows: about 5.5 GB)."
  type        = number
  default     = 20000000000
}

variable "radar_every_minutes" {
  description = "Minutes between scheduled Radar runs. 1440: once a day (at radar_run_at)."
  type        = number
  default     = 1440
}

variable "radar_run_at" {
  description = "With a daily period: the local time (the institution's time zone, HH:MM) the scheduled Radar run starts. Empty: every radar_every_minutes."
  type        = string
  default     = "06:00"
}

variable "radar_run_now_per_day" {
  description = "How many times a day people may use Radar's Check now (the prototype's limit, shown on the Radar page)."
  type        = number
  default     = 5
}

variable "server_env" {
  description = "Extra settings for the server (server/.env.example lists them all), e.g. { SERIES_MAX = \"6\" }."
  type        = map(string)
  default     = {}
}

variable "log_level" {
  description = "Lowest level every service logs: INFO (default: one line per tick, run or turn, plus warnings and errors), or WARNING for less, DEBUG while chasing a problem."
  type        = string
  default     = "INFO"
  validation {
    condition     = contains(["DEBUG", "INFO", "WARNING", "ERROR"], var.log_level)
    error_message = "log_level is DEBUG, INFO, WARNING or ERROR."
  }
}

variable "server_min_instances" {
  description = "Server instances kept running. 0 (default): it stops when idle and the first visit after a quiet spell waits for it to start. 1: no wait, at the cost of one always-on instance (roughly USD 10 or more a month); worth it while reviewers use it."
  type        = number
  default     = 0
}

variable "server_max_instances" {
  description = "Most server instances."
  type        = number
  default     = 2
}

# ------------------------------------------------------------------ the database

variable "sql_tier" {
  description = "Cloud SQL machine type. db-f1-micro is the smallest (shared core)."
  type        = string
  default     = "db-f1-micro"
}

variable "sql_disk_gb" {
  description = "Cloud SQL disk size (grows by itself)."
  type        = number
  default     = 10
}

variable "protect_database" {
  description = "Deletion protection on the database. Set false only to destroy everything on purpose."
  type        = bool
  default     = true
}

# ------------------------------------------------------------------ cost alert

variable "billing_account_id" {
  description = "Your billing account (XXXXXX-XXXXXX-XXXXXX) for a budget alert. Empty: no budget."
  type        = string
  default     = ""
}

variable "budget_amount" {
  description = "Monthly budget in your billing account's currency; emails at 50%, 90% and 100%."
  type        = number
  default     = 20
}
