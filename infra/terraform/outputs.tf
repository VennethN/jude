output "db_connection_string_template" {
  description = "Replace PASSWORD_URL_ENCODED with the URL-encoded password from db_master_secret_arn. This output does not contain the password."
  value       = "postgresql://${aws_db_instance.main.username}:PASSWORD_URL_ENCODED@${aws_db_instance.main.endpoint}/${aws_db_instance.main.db_name}?sslmode=require"
}

output "db_engine_version" {
  description = "Resolved PostgreSQL version available in Jakarta."
  value       = aws_db_instance.main.engine_version_actual
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "db_subnet_ids" {
  description = "Database subnets; internet-routable when db_publicly_accessible is enabled."
  value       = aws_subnet.private[*].id
}

output "app_security_group_id" {
  description = "Attach to application resources in this VPC to allow PostgreSQL connections. Egress only permits the database."
  value       = aws_security_group.app.id
}

output "db_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "db_name" {
  value = aws_db_instance.main.db_name
}

output "db_master_secret_arn" {
  description = "Secret ARN only; credential values are managed by RDS outside Terraform."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}
