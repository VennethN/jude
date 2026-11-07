#!/bin/bash
set -euo pipefail
dnf install -y docker jq
systemctl enable --now docker amazon-ssm-agent
install -d -m 0700 /opt/jude /run/jude
if ! test -f /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi
