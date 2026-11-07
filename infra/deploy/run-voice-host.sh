#!/bin/bash
# Invoked through SSM after building locally or pulling an immutable ECR image.
set -euo pipefail
umask 077
export AWS_DEFAULT_REGION=ap-southeast-3 AWS_PAGER=""
image=${JUDE_IMAGE:-jude:current}
docker image inspect "$image" >/dev/null
install -d -m 0700 /run/jude /etc/jude/certs
aws ssm get-parameters-by-path --path /jude-dev/runtime/ --with-decryption --output json |
  jq -er '.Parameters[] | (.Name | split("/") | last) as $key |
    if ($key | test("^[A-Z][A-Z0-9_]*$")) and (.Value | test("[\r\n]") | not)
    then "\($key)=\(.Value)" else error("Invalid runtime setting") end' > /run/jude/app.env
curl -fsS --retry 4 https://truststore.pki.rds.amazonaws.com/ap-southeast-3/ap-southeast-3-bundle.pem \
  -o /etc/jude/certs/rds-ca.pem
chmod 0644 /etc/jude/certs/rds-ca.pem
# Validate the persistent, offline model before replacing running containers.
model_mount=()
model=$(sed -n 's/^JUDE_DIARIZATION_MODEL=//p' /run/jude/app.env)
if [[ -n "$model" ]]; then
  if [[ "$model" != /models/community-1 || ! -r /var/lib/jude/models/community-1/config.yaml ]]; then
    echo 'Provision Community-1 and set JUDE_DIARIZATION_MODEL=/models/community-1.' >&2
    exit 1
  fi
  model_mount=(--mount type=bind,src=/var/lib/jude/models/community-1,dst=/models/community-1,readonly -e HF_HUB_OFFLINE=1)
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=512m -e HOME=/tmp -e PYANNOTE_METRICS_ENABLED=0 \
    "${model_mount[@]}" "$image" python -c \
    'from pyannote.audio import Pipeline; Pipeline.from_pretrained("/models/community-1"); print("Offline diarization model ready")'
fi
docker network inspect jude >/dev/null 2>&1 || docker network create jude >/dev/null
cat > /etc/jude/Caddyfile <<'CADDY'
{
  admin off
  auto_https off
}
:80 {
  encode zstd gzip
  reverse_proxy jude-app:3000 {
    flush_interval -1
  }
}
CADDY
chmod 0644 /etc/jude/Caddyfile
for container in jude-proxy jude-app; do
  if docker container inspect "$container" >/dev/null 2>&1; then docker rm -f "$container" >/dev/null; fi
done
docker run -d --name jude-app --network jude --restart unless-stopped \
  --init --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=1g --env-file /run/jude/app.env "${model_mount[@]}" \
  -e NODE_EXTRA_CA_CERTS=/run/rds-ca.pem -e BODY_SIZE_LIMIT=64M -e HOME=/tmp \
  -e HF_HOME=/tmp/huggingface -e PYANNOTE_METRICS_ENABLED=0 \
  --mount type=bind,src=/etc/jude/certs/rds-ca.pem,dst=/run/rds-ca.pem,readonly \
  --log-opt max-size=10m --log-opt max-file=3 "$image" >/dev/null
for attempt in {1..60}; do
  if docker exec jude-app node --input-type=module -e \
    'const r=await Promise.all([3000,3001].map(async p=>{const r=await fetch(`http://127.0.0.1:${p}/healthz`,{signal:AbortSignal.timeout(3000)});return r.ok && r.headers.get("x-jude-revision")===process.env.JUDE_REVISION;})); process.exit(r.every(Boolean)?0:1)' \
    >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then echo 'Web or voice database readiness failed' >&2; exit 1; fi
  sleep 2
done
docker run -d --name jude-proxy --network jude --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --sysctl net.ipv4.ip_unprivileged_port_start=0 -p 80:80 \
  -e XDG_CONFIG_HOME=/config -e XDG_DATA_HOME=/data \
  --tmpfs /config:rw,nosuid,nodev --tmpfs /data:rw,nosuid,nodev \
  --mount type=bind,src=/etc/jude/Caddyfile,dst=/etc/caddy/Caddyfile,readonly \
  --log-opt max-size=10m --log-opt max-file=3 \
  "$image" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
for attempt in {1..20}; do
  if curl -fsS --max-time 3 http://127.0.0.1/healthz >/dev/null; then break; fi
  if [ "$attempt" = 20 ]; then echo 'EC2 HTTP proxy readiness failed' >&2; exit 1; fi
  sleep 2
done
echo 'Web and Python voice are healthy; HTTPS is served by CloudFront.'
