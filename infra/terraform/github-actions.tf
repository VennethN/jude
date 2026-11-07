variable "github_repository" {
  description = "GitHub owner/repository permitted to deploy main using the existing GitHub OIDC provider."
  type        = string
  default     = null
  validation {
    condition     = var.github_repository == null ? true : can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "Use owner/repository."
  }
}

variable "github_oidc_subject_prefix" {
  description = "Exact sub_claim_prefix from GitHub's actions/oidc/customization/sub API; supports immutable owner and repository IDs."
  type        = string
  default     = null
  validation {
    condition     = var.github_oidc_subject_prefix == null ? true : can(regex("^repo:[A-Za-z0-9_.-]+(@[0-9]+)?/[A-Za-z0-9_.-]+(@[0-9]+)?$", var.github_oidc_subject_prefix))
    error_message = "Use the exact repo:owner[@id]/repository[@id] subject prefix returned by GitHub."
  }
}

data "aws_caller_identity" "deployment" {}

locals {
  github_deploy_count = var.github_repository != null && local.voice_count == 1 ? 1 : 0
}

resource "aws_iam_role" "github_deploy" {
  count = local.github_deploy_count
  name  = "${local.name}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = "sts:AssumeRoleWithWebIdentity",
      Principal = { Federated = "arn:aws:iam::${data.aws_caller_identity.deployment.account_id}:oidc-provider/token.actions.githubusercontent.com" },
      Condition = { StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub" = "${coalesce(var.github_oidc_subject_prefix, "repo:${coalesce(var.github_repository, "unconfigured")}")}:ref:refs/heads/main"
      } }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  count = local.github_deploy_count
  name  = "deploy-ec2"
  role  = aws_iam_role.github_deploy[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Effect   = "Allow",
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage"],
        Resource = aws_ecr_repository.app[0].arn
      },
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.files[0].arn}/_deploy/releases/*" },
      {
        Effect    = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = aws_kms_key.files[0].arn,
        Condition = { StringEquals = { "kms:ViaService" = "s3.ap-southeast-3.amazonaws.com" } }
      },
      {
        Effect = "Allow", Action = ["ssm:SendCommand"], Resource = [
          "arn:aws:ssm:ap-southeast-3::document/AWS-RunShellScript",
          aws_instance.voice[0].arn
        ]
      },
      { Effect = "Allow", Action = ["ssm:GetCommandInvocation"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = "ap-southeast-3" } } }
    ]
  })
}

output "github_deploy_role_arn" {
  value = one(aws_iam_role.github_deploy[*].arn)
}
