data "aws_rds_engine_version" "postgres" {
  engine  = "postgres"
  latest  = true
  version = var.db_engine_version == "latest" ? null : var.db_engine_version
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "postgres" {
  name_prefix = "${local.name}-${data.aws_rds_engine_version.postgres.parameter_group_family}-"
  family      = data.aws_rds_engine_version.postgres.parameter_group_family
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier                      = local.name
  engine                          = "postgres"
  engine_version                  = data.aws_rds_engine_version.postgres.version_actual
  instance_class                  = var.db_instance_class
  allocated_storage               = 20
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  db_name                         = "app"
  username                        = "dbadmin"
  manage_master_user_password     = true
  port                            = 5432
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.db.id]
  parameter_group_name            = aws_db_parameter_group.postgres.name
  publicly_accessible             = var.db_publicly_accessible
  multi_az                        = var.db_multi_az
  backup_retention_period         = var.db_backup_days
  backup_window                   = "18:00-19:00"
  maintenance_window              = "sun:19:30-sun:20:30"
  auto_minor_version_upgrade      = true
  allow_major_version_upgrade     = false
  apply_immediately               = false
  deletion_protection             = var.db_deletion_protection
  skip_final_snapshot             = false
  final_snapshot_identifier       = coalesce(var.final_snapshot_identifier, "${local.name}-final")
  copy_tags_to_snapshot           = true
  performance_insights_enabled    = false
  enabled_cloudwatch_logs_exports = ["postgresql"]

  depends_on = [aws_route.db_internet, aws_route_table_association.private]

  lifecycle {
    precondition {
      condition     = !var.db_publicly_accessible || length(var.db_allowed_public_cidrs) > 0
      error_message = "Public access requires at least one IPv4 CIDR in db_allowed_public_cidrs."
    }
  }
}
