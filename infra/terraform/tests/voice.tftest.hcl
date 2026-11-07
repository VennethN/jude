mock_provider "aws" {
  mock_resource "aws_db_instance" {
    defaults = {
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:ap-southeast-3:920373022608:secret:test-master"
        secret_status = "active"
        kms_key_id    = "test-key"
      }]
    }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "920373022608" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-southeast-3a", "ap-southeast-3b"] }
  }
  mock_data "aws_rds_engine_version" {
    defaults = { parameter_group_family = "postgres18", version_actual = "18.6" }
  }
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_data "aws_ec2_managed_prefix_list" {
    defaults = { id = "pl-0123456789abcdef0" }
  }
}

run "github_deploy_trust_is_main_only" {
  command = apply
  variables {
    enable_application = true
    enable_voice_host  = true
    github_repository  = "VennethN/jude"
  }
  assert {
    condition = jsondecode(aws_iam_role.github_deploy[0].assume_role_policy).Statement[0].Condition.StringEquals == {
      "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
      "token.actions.githubusercontent.com:sub" = "repo:VennethN/jude:ref:refs/heads/main"
    }
    error_message = "Deployment must accept GitHub OIDC only for this repository's main branch and AWS audience."
  }
  assert {
    condition = alltrue([
      for rule in jsondecode(aws_iam_role_policy.github_deploy[0].policy).Statement :
      !contains(rule.Action, "ssm:GetParameter") && !contains(rule.Action, "ssm:GetParametersByPath") && !contains(rule.Action, "secretsmanager:GetSecretValue")
    ])
    error_message = "GitHub builds must not retrieve application runtime secrets."
  }
}

run "web_and_python_share_one_ec2" {
  command = plan
  variables {
    enable_application      = true
    enable_voice_host       = true
    db_publicly_accessible  = false
    db_allowed_public_cidrs = []
  }
  assert {
    condition     = length(aws_instance.voice) == 1 && length(aws_instance.web) == 0
    error_message = "Combined web and Python hosting must use one EC2, without a duplicate application host."
  }
  assert {
    condition     = aws_instance.voice[0].metadata_options[0].http_tokens == "required"
    error_message = "The application host must require IMDSv2."
  }
  assert {
    condition     = length(aws_security_group.voice_origin[0].ingress) == 1 && alltrue([for rule in aws_security_group.voice_origin[0].ingress : rule.from_port == 80 && rule.to_port == 80 && length(rule.prefix_list_ids) == 1 && try(length(rule.cidr_blocks), 0) == 0 && try(length(rule.ipv6_cidr_blocks), 0) == 0])
    error_message = "Only CloudFront may reach the HTTP origin; backend ports and SSH must not be exposed."
  }
  assert {
    condition     = aws_cloudfront_distribution.voice[0].default_cache_behavior[0].cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    error_message = "Authenticated web/API responses must not be cached by CloudFront."
  }
}

run "application_disabled_has_no_host_url" {
  command = plan
  variables {
    enable_application = false
    enable_voice_host  = true
  }
  assert {
    condition     = output.voice_web_url == null && length(aws_instance.voice) == 0
    error_message = "A disabled application must not index an absent distribution or expose a host URL."
  }
}
