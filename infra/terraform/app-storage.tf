resource "aws_kms_key" "files" {
  count                   = local.app_count
  description             = "${local.name} private case originals"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "files" {
  count         = local.app_count
  name          = "alias/${local.name}-files"
  target_key_id = aws_kms_key.files[0].key_id
}

resource "aws_s3_bucket" "files" {
  count         = local.app_count
  bucket_prefix = "${substr(local.name, 0, 29)}-files-"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "files" {
  count                   = local.app_count
  bucket                  = aws_s3_bucket.files[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "files" {
  count  = local.app_count
  bucket = aws_s3_bucket.files[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  count  = local.app_count
  bucket = aws_s3_bucket.files[0].id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.files[0].arn
    }
  }
}

resource "aws_s3_bucket_policy" "files" {
  count  = local.app_count
  bucket = aws_s3_bucket.files[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "RequireTLS"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.files[0].arn, "${aws_s3_bucket.files[0].arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_ecr_repository" "app" {
  count                = local.app_count
  name                 = "${local.name}/app"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_secretsmanager_secret" "app" {
  count                   = local.app_count
  name                    = "${local.name}/application"
  description             = "Jude runtime environment for the application database and optional external providers"
  recovery_window_in_days = 30
}

resource "aws_ssm_parameter" "app_image" {
  count = local.app_host_count
  name  = "/${local.name}/release/digest"
  type  = "String"
  value = var.app_image_digest
}
