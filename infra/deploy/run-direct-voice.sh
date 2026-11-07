#!/usr/bin/env bash
# Public HTTPS voice gateway on the existing EC2 host; no CloudFront hop.
set -euo pipefail
export AWS_DEFAULT_REGION=ap-southeast-3 AWS_PAGER=""
image=${JUDE_IMAGE:-$(docker inspect --format '{{.Image}}' jude-app)}
host=$(aws ssm get-parameter --name /jude-dev/runtime/JUDE_VOICE_PUBLIC_HOST --query Parameter.Value --output text)
origin=$(aws ssm get-parameter --name /jude-dev/runtime/ORIGIN --with-decryption --query Parameter.Value --output text)
[[ "$host" =~ ^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo 'Invalid voice hostname' >&2; exit 1; }
[[ "$origin" =~ ^https://[a-z0-9.-]+$ ]] || { echo 'Invalid web origin' >&2; exit 1; }
install -d -m 0700 -o 1000 -g 1000 /var/lib/jude/direct-caddy/data /var/lib/jude/direct-caddy/config
install -d -m 0755 /etc/jude
cat > /etc/jude/VoiceCaddyfile <<CADDY
{
  admin off
  auto_https disable_redirects
}
$host {
  tls {
    issuer acme {
      disable_http_challenge
    }
  }
  @direct_origin header Origin https://$host
  request_header @direct_origin Origin $origin
  header Strict-Transport-Security "max-age=31536000"
  handle /api/live/* {
    reverse_proxy jude-app:3000 {
      flush_interval -1
    }
  }
  handle /healthz {
    reverse_proxy jude-app:3000
  }
  handle {
    respond "Voice API: /api/live/capabilities" 404
  }
}
CADDY
chmod 0644 /etc/jude/VoiceCaddyfile
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /config:rw,nosuid,nodev --tmpfs /data:rw,nosuid,nodev \
  -e XDG_CONFIG_HOME=/config -e XDG_DATA_HOME=/data \
  --mount type=bind,src=/etc/jude/VoiceCaddyfile,dst=/etc/caddy/Caddyfile,readonly \
  "$image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
if docker container inspect jude-voice-gateway >/dev/null 2>&1; then docker rm -f jude-voice-gateway >/dev/null; fi
docker run -d --name jude-voice-gateway --network jude --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --sysctl net.ipv4.ip_unprivileged_port_start=0 -p 443:443 \
  -e XDG_CONFIG_HOME=/config -e XDG_DATA_HOME=/data \
  --mount type=bind,src=/etc/jude/VoiceCaddyfile,dst=/etc/caddy/Caddyfile,readonly \
  --mount type=bind,src=/var/lib/jude/direct-caddy/data,dst=/data \
  --mount type=bind,src=/var/lib/jude/direct-caddy/config,dst=/config \
  --log-opt max-size=10m --log-opt max-file=3 \
  "$image" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
echo 'Direct HTTPS gateway started; certificate issuance may take a moment.'
