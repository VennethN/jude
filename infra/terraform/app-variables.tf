variable "enable_application" {
  description = "Provision the optional application registry, encrypted object storage, service secret, network and stable web address."
  type        = bool
  default     = false
}

variable "app_hostname" {
  description = "Public DNS hostname for automatic TLS. Required when app_image_digest is set."
  type        = string
  default     = null
  validation {
    condition     = var.app_hostname == null ? true : can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.app_hostname))
    error_message = "Use a lowercase fully qualified hostname such as jude.example.org."
  }
}

variable "app_image_digest" {
  description = "Image digest already pushed to this environment's ECR repository. Null provisions the supporting resources without launching EC2."
  type        = string
  default     = null
  validation {
    condition     = var.app_image_digest == null ? true : can(regex("^sha256:[a-f0-9]{64}$", var.app_image_digest))
    error_message = "Use a sha256 image digest."
  }
}

variable "app_instance_type" {
  description = "x86-64 EC2 instance for the web and voice services, OCR, and document conversion."
  type        = string
  default     = "t3.medium"
}

variable "app_root_volume_gb" {
  description = "Encrypted gp3 root volume in GiB, including containers and any provisioned diarization weights."
  type        = number
  default     = 30
  validation {
    condition     = var.app_root_volume_gb >= 30 && var.app_root_volume_gb <= 16384 && floor(var.app_root_volume_gb) == var.app_root_volume_gb
    error_message = "Set the root volume to a whole number from 30 to 16384 GiB."
  }
}

variable "app_ami_id" {
  description = "Optional pinned x86-64 Amazon Linux 2023 AMI in Jakarta."
  type        = string
  default     = null
}

variable "app_mail_identity_arn" {
  description = "Optional verified Jakarta SES identity for invitations and password reset."
  type        = string
  default     = null
  validation {
    condition     = var.app_mail_identity_arn == null ? true : can(regex("^arn:aws:ses:ap-southeast-3:[0-9]{12}:identity/[a-zA-Z0-9.@_-]+$", var.app_mail_identity_arn))
    error_message = "Provide the ARN of a verified SES email address or domain in Jakarta."
  }
}

locals {
  app_count       = var.enable_application ? 1 : 0
  app_host_count  = var.enable_application && var.app_image_digest != null ? 1 : 0
  app_region      = "ap-southeast-3"
  app_deploy_path = "${path.module}/../deploy"
}
