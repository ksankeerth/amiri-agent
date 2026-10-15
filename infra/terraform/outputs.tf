output "server_url" {
  description = "Open this: the web app (use this URL, not another one Cloud Run lists: sign-in checks the hostname)."
  value       = local.server_url
}

output "server_hostname" {
  description = "Add this domain to your reCAPTCHA key."
  value       = local.server_hostname
}

output "sql_instance" {
  description = "The Cloud SQL instance (for infra/scripts/secrets.sh)."
  value       = google_sql_database_instance.db.name
}

output "sql_connection_name" {
  description = "PROJECT:REGION:INSTANCE, the socket the server connects through."
  value       = google_sql_database_instance.db.connection_name
}

output "registry" {
  description = "Where infra/scripts/build.sh pushes the images."
  value       = local.registry
}

output "build_service_account" {
  description = "Cloud Build runs as this account."
  value       = google_service_account.sa["build"].email
}

output "ops_service_account" {
  description = "Mint an ID token as this account for scripts against the API."
  value       = google_service_account.sa["ops"].email
}

output "awake" {
  description = "Whether the database runs and the tick is scheduled."
  value       = var.awake
}
