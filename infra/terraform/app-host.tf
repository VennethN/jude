resource "aws_subnet" "web" {
  count             = local.app_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 20)
  availability_zone = data.aws_availability_zones.available.names[0]
  tags              = { Name = "${local.name}-web" }
}

resource "aws_route_table" "web" {
  count  = local.app_count
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-web" }
}

resource "aws_route" "web_internet" {
  count                  = local.app_count
  route_table_id         = aws_route_table.web[0].id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.db[0].id
}

resource "aws_route_table_association" "web" {
  count          = local.app_count
  subnet_id      = aws_subnet.web[0].id
  route_table_id = aws_route_table.web[0].id
}

resource "aws_security_group" "web" {
  count       = local.app_count
  name_prefix = "${local.name}-web-"
  description = "HTTPS service and certificate validation"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "web_ingress" {
  for_each          = var.enable_application ? toset(["80", "443"]) : toset([])
  security_group_id = aws_security_group.web[0].id
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "web_https" {
  count             = local.app_count
  security_group_id = aws_security_group.web[0].id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Registry, provider APIs, certificate issuance, and system updates"
}

resource "aws_eip" "web" {
  count  = local.app_count
  domain = "vpc"
  tags   = { Name = "${local.name}-web" }
}

data "aws_ssm_parameter" "app_ami" {
  count = local.app_host_count == 1 && var.app_ami_id == null ? 1 : 0
  name  = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_instance" "web" {
  count                       = local.app_host_count
  ami                         = var.app_ami_id == null ? nonsensitive(data.aws_ssm_parameter.app_ami[0].value) : var.app_ami_id
  instance_type               = var.app_instance_type
  subnet_id                   = aws_subnet.web[0].id
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.app.id, aws_security_group.web[0].id]
  iam_instance_profile        = aws_iam_instance_profile.app[0].name
  user_data_replace_on_change = true
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }
  root_block_device {
    encrypted   = true
    volume_type = "gp3"
    volume_size = var.app_root_volume_gb
  }
  user_data_base64 = base64gzip(join("\n", ["#cloud-config", yamlencode({
    write_files = [
      { path = "/usr/local/sbin/jude-release", permissions = "0750", content = file("${local.app_deploy_path}/release.sh") },
      { path = "/etc/systemd/system/jude.service", permissions = "0644", content = file("${local.app_deploy_path}/jude.service") },
      { path = "/etc/jude/Caddyfile", permissions = "0644", content = file("${local.app_deploy_path}/Caddyfile") },
      { path = "/etc/jude/host.env", permissions = "0600", content = join("\n", [
        "JUDE_REGION=${local.app_region}",
        "JUDE_HOST=${coalesce(var.app_hostname, "unconfigured.invalid")}",
        "JUDE_RELEASE_PARAMETER=${aws_ssm_parameter.app_image[0].name}",
        "JUDE_REGISTRY=${aws_ecr_repository.app[0].repository_url}",
        "JUDE_SECRET_ARN=${aws_secretsmanager_secret.app[0].arn}",
        "JUDE_FILES_BUCKET=${aws_s3_bucket.files[0].id}",
        "JUDE_FILES_KEY=${aws_kms_key.files[0].arn}"
      ]) }
    ]
    runcmd = [
      ["dnf", "install", "-y", "docker", "jq"],
      ["systemctl", "enable", "--now", "docker"],
      ["systemctl", "daemon-reload"],
      ["systemctl", "enable", "--now", "jude.service"]
    ]
  })]))
  tags = { Name = "${local.name}-web" }
  lifecycle {
    ignore_changes = [ami]
    precondition {
      condition     = var.app_hostname != null
      error_message = "Set app_hostname and point its DNS A record at app_public_ip before starting the application."
    }
  }
  depends_on = [aws_route.web_internet, aws_route_table_association.web, aws_iam_role_policy.app_host]
}

resource "aws_eip_association" "web" {
  count         = local.app_host_count
  instance_id   = aws_instance.web[0].id
  allocation_id = aws_eip.web[0].id
}

output "app_public_ip" {
  description = "DNS A record value for the TLS endpoint."
  value       = one(aws_eip.web[*].public_ip)
}

output "app_registry" {
  description = "ECR repository URL for this environment's release images."
  value       = one(aws_ecr_repository.app[*].repository_url)
}

output "app_secret_arn" {
  description = "Write the runtime JSON secret to this ARN through Secrets Manager."
  value       = one(aws_secretsmanager_secret.app[*].arn)
}

output "app_instance_id" {
  description = "EC2 managed instance for SSM Session Manager."
  value       = one(aws_instance.web[*].id)
}
