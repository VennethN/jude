variable "enable_voice_host" {
  description = "Deploy the Jakarta EC2 host for the SvelteKit frontend, web API and Python voice service."
  type        = bool
  default     = false
}

locals {
  voice_count = var.enable_voice_host && var.enable_application ? 1 : 0
}

data "aws_ssm_parameter" "voice_ami" {
  count = local.voice_count
  name  = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  count = local.voice_count
  name  = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "voice_origin" {
  count       = local.voice_count
  name_prefix = "${local.name}-voice-origin-"
  vpc_id      = aws_vpc.main.id
  description = "HTTP from CloudFront only; administration through SSM"
  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront[0].id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "voice" {
  count       = local.voice_count
  name_prefix = "${local.name}-voice-"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "voice" {
  count = local.voice_count
  role  = aws_iam_role.voice[0].id
  name  = "voice-runtime"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ssm:GetParametersByPath", "ssm:GetParameter", "ssm:GetParameters"], Resource = "arn:aws:ssm:ap-southeast-3:*:parameter/${local.name}/runtime/*" },
      { Effect = "Allow", Action = ["ssm:UpdateInstanceInformation", "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"], Resource = "*" },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.files[0].arn}/*" },
      { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = aws_kms_key.files[0].arn }
    ]
  })
}

resource "aws_iam_instance_profile" "voice" {
  count       = local.voice_count
  name_prefix = "${local.name}-voice-"
  role        = aws_iam_role.voice[0].name
}

resource "aws_instance" "voice" {
  count                       = local.voice_count
  ami                         = nonsensitive(data.aws_ssm_parameter.voice_ami[0].value)
  instance_type               = var.app_instance_type
  subnet_id                   = aws_subnet.web[0].id
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.voice_origin[0].id, aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.voice[0].name
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }
  root_block_device {
    encrypted   = true
    volume_type = "gp3"
    volume_size = 40
    tags        = { Name = "${local.name}-voice", Hackathon = "true" }
  }
  user_data = file("${path.module}/../deploy/bootstrap-voice.sh")
  tags      = { Name = "${local.name}-voice" }
  lifecycle { ignore_changes = [ami] }
  depends_on = [aws_iam_role_policy.voice, aws_route.web_internet, aws_route_table_association.web]
}

resource "aws_eip_association" "voice" {
  count         = local.voice_count
  allocation_id = aws_eip.web[0].id
  instance_id   = aws_instance.voice[0].id
}

resource "aws_cloudfront_distribution" "voice" {
  count           = local.voice_count
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Jude hackathon HTTPS frontend, web API and Python voice hosted on Jakarta EC2"
  price_class     = "PriceClass_All"
  origin {
    domain_name = "ec2-${replace(aws_eip.web[0].public_ip, ".", "-")}.ap-southeast-3.compute.amazonaws.com"
    origin_id   = "voice-host"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  default_cache_behavior {
    target_origin_id         = "voice-host"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
  tags = { Name = "${local.name}-voice" }
}

output "voice_instance_id" { value = one(aws_instance.voice[*].id) }
output "voice_web_url" { value = local.voice_count == 1 ? "https://${aws_cloudfront_distribution.voice[0].domain_name}" : null }
output "voice_files_bucket" { value = one(aws_s3_bucket.files[*].id) }
output "voice_files_key" { value = one(aws_kms_key.files[*].arn) }
