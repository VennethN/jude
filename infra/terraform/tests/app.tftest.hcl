mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-southeast-3a", "ap-southeast-3b"] }
  }
  mock_data "aws_rds_engine_version" {
    defaults = { parameter_group_family = "postgres16", version_actual = "16.8" }
  }
}

run "database_only" {
  command = plan
  variables {
    enable_application      = false
    db_publicly_accessible  = false
    db_allowed_public_cidrs = []
  }
  assert {
    condition     = length(aws_instance.web) == 0 && length(aws_s3_bucket.files) == 0 && length(aws_internet_gateway.db) == 0
    error_message = "The existing private database configuration must gate all application resources."
  }
}

run "registry_first" {
  command = plan
  variables {
    enable_application      = true
    db_publicly_accessible  = false
    db_allowed_public_cidrs = []
  }
  assert {
    condition     = length(aws_ecr_repository.app) == 1 && length(aws_instance.web) == 0 && length(aws_eip.web) == 1
    error_message = "The registry, secret and public address can be prepared before an image exists."
  }
  assert {
    condition     = length(aws_internet_gateway.db) == 1 && length(aws_route.db_internet) == 0
    error_message = "Application connectivity must not give private database subnets an internet route."
  }
}

run "private_database_with_web_host" {
  command = plan
  variables {
    enable_application      = true
    db_publicly_accessible  = false
    db_allowed_public_cidrs = []
    app_hostname            = "case.example.org"
    app_image_digest        = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    app_ami_id              = "ami-00000000000000000"
    app_root_volume_gb      = 96
  }
  assert {
    condition     = length(aws_instance.web) == 1 && aws_instance.web[0].metadata_options[0].http_tokens == "required"
    error_message = "A pinned release needs one IMDSv2-only application host."
  }
  assert {
    condition     = aws_instance.web[0].root_block_device[0].encrypted && aws_instance.web[0].root_block_device[0].volume_size == 96
    error_message = "The host needs an encrypted operator-sized volume for containers and optional model weights."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.files[0].block_public_policy && aws_s3_bucket_public_access_block.files[0].restrict_public_buckets
    error_message = "Original case documents must remain private."
  }
}
