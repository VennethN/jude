resource "aws_iam_role" "app_host" {
  count       = local.app_count
  name_prefix = "${substr(local.name, 0, 27)}-web-"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "app_host" {
  count = local.app_host_count
  role  = aws_iam_role.app_host[0].id
  name  = "runtime"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid    = "ReadRuntimeSecret", Effect = "Allow",
        Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.app[0].arn
      },
      {
        Sid      = "ReadRelease", Effect = "Allow", Action = ["ssm:GetParameter"],
        Resource = aws_ssm_parameter.app_image[0].arn
      },
      {
        Sid       = "RetrieveRegistryToken", Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*",
        Condition = { StringEquals = { "aws:RequestedRegion" = local.app_region } }
      },
      {
        Sid      = "PullApplicationImage", Effect = "Allow",
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
        Resource = aws_ecr_repository.app[0].arn
      },
      {
        Sid      = "PrivateCaseOriginals", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        Resource = "${aws_s3_bucket.files[0].arn}/*"
      },
      {
        Sid       = "UseFileKeyThroughS3", Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"],
        Resource  = aws_kms_key.files[0].arn,
        Condition = { StringEquals = { "kms:ViaService" = "s3.${local.app_region}.amazonaws.com" } }
      },
      {
        Sid       = "ManageThroughSessionManager", Effect = "Allow",
        Action    = ["ssm:UpdateInstanceInformation", "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"],
        Resource  = "*",
        Condition = { StringEquals = { "aws:RequestedRegion" = local.app_region } }
      }
      ], var.app_mail_identity_arn == null ? [] : [{
        Sid = "SendAccountMail", Effect = "Allow", Action = ["ses:SendEmail"], Resource = var.app_mail_identity_arn
    }])
  })
}

resource "aws_iam_instance_profile" "app" {
  count       = local.app_count
  name_prefix = "${substr(local.name, 0, 27)}-web-"
  role        = aws_iam_role.app_host[0].name
}
