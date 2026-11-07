variable "db_publicly_accessible" {
  description = "Enable direct internet connectivity using the configured IPv4 CIDR rules."
  type        = bool
  default     = false
}

variable "db_allowed_public_cidrs" {
  description = "Public client IPv4 CIDRs. 0.0.0.0/0 permits connections from any IPv4 address."
  type        = set(string)
  default     = []
  validation {
    condition = alltrue([
      for cidr in var.db_allowed_public_cidrs :
      can(cidrnetmask(cidr))
    ])
    error_message = "Provide valid IPv4 CIDRs."
  }
}

variable "project" {
  type    = string
  default = "jude"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,29}[a-z0-9]$", var.project))
    error_message = "Use 2–31 lowercase letters, digits or hyphens, starting with a letter and ending with a letter or digit."
  }
}

variable "environment" {
  type    = string
  default = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging or prod."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
  validation {
    condition     = can(cidrsubnet(var.vpc_cidr, 8, 11))
    error_message = "Provide an IPv4 CIDR with room for at least 12 subnets using eight extra prefix bits."
  }
}

variable "db_instance_class" {
  description = "Confirm availability for the selected PostgreSQL release in Jakarta before applying."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "Use latest for the newest available RDS PostgreSQL in Jakarta, or pin a version."
  type        = string
  default     = "latest"
  validation {
    condition     = var.db_engine_version == "latest" || can(regex("^[0-9]+(\\.[0-9]+)?$", var.db_engine_version))
    error_message = "Use latest or a PostgreSQL version such as 18.1."
  }
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_backup_days" {
  type    = number
  default = 7
  validation {
    condition     = var.db_backup_days >= 1 && var.db_backup_days <= 35 && floor(var.db_backup_days) == var.db_backup_days
    error_message = "Backup retention must be an integer between 1 and 35 days."
  }
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

variable "final_snapshot_identifier" {
  description = "Unique snapshot name per teardown. A final snapshot is always required."
  type        = string
  default     = null
  nullable    = true
}
