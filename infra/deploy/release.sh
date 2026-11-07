#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_DEFAULT_REGION="$JUDE_REGION" AWS_PAGER=""
work=$(mktemp -d /run/jude/release.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
export DOCKER_CONFIG="$work/docker"
mkdir -p "$DOCKER_CONFIG"

digest=$(aws ssm get-parameter --name "$JUDE_RELEASE_PARAMETER" --query 'Parameter.Value' --output text)
if [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "The Jude release parameter must contain an image digest." >&2
  exit 1
fi
image="$JUDE_REGISTRY@$digest"
aws ecr get-login-password | docker login --username AWS --password-stdin "${JUDE_REGISTRY%%/*}"
docker pull "$image"

# Limit the runtime secret to application values. Keep it on the host's tmpfs.
aws secretsmanager get-secret-value --secret-id "$JUDE_SECRET_ARN" --query SecretString --output text > "$work/settings.json"
jq -er '
  if type != "object" or (.DATABASE_URL | type) != "string" or (.DATABASE_URL | length) == 0 then
    error("Set DATABASE_URL in the Jude application secret.")
  elif any(to_entries[]; (.key | test("^(DATABASE_URL|OPENAI_(API_KEY|PROJECT_ID|MODEL|[A-Z_]+_MODEL)|JUDE_(MAIL_FROM|PASAL_URL|PASAL_TOKEN|DELETE_GRACE_DAYS))$") | not)
    or (.value | type != "string") or (.value | test("[\\r\\n]")))
  then error("Use supported environment names and single-line string values.")
  else to_entries[] | "\(.key)=\(.value)"
  end
' "$work/settings.json" > "$work/app.env"
install -d -m 0755 /etc/jude/certs
curl --fail --silent --show-error --retry 4 --proto '=https' \
  "https://truststore.pki.rds.amazonaws.com/$JUDE_REGION/$JUDE_REGION-bundle.pem" -o "$work/rds-ca.pem"
install -m 0644 "$work/rds-ca.pem" /etc/jude/certs/rds-ca.pem

if ! docker network inspect jude >/dev/null 2>&1; then docker network create jude >/dev/null; fi
install -d -m 0700 -o 1000 -g 1000 /var/lib/jude/caddy/data /var/lib/jude/caddy/config
# All inputs and the next image are available before replacing the running release.
for container in jude-proxy jude-app; do
  if docker container inspect "$container" >/dev/null 2>&1; then docker rm -f "$container" >/dev/null; fi
done
docker run -d --name jude-app --network jude --restart unless-stopped \
  --init --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=2g --env-file "$work/app.env" \
  -e "ORIGIN=https://$JUDE_HOST" -e "WEB_ORIGIN=https://$JUDE_HOST" \
  -e "AWS_REGION=$JUDE_REGION" -e "JUDE_S3_BUCKET=$JUDE_FILES_BUCKET" -e "JUDE_S3_KMS_KEY=$JUDE_FILES_KEY" \
  -e NODE_EXTRA_CA_CERTS=/run/rds-ca.pem -e BODY_SIZE_LIMIT=64M -e HOME=/tmp \
  --mount type=bind,src=/etc/jude/certs/rds-ca.pem,dst=/run/rds-ca.pem,readonly \
  --log-opt max-size=10m --log-opt max-file=3 "$image" >/dev/null

healthy=false
for attempt in {1..30}; do
  if docker exec -i jude-app node --input-type=module <<'CHECK_SERVICES'
const services = [3000, 3001];
const ready = await Promise.all(services.map(async (port) => {
  try {
    const url = 'http://127.0.0.1:' + port + '/healthz';
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}));
process.exit(ready.every(Boolean) ? 0 : 1);
CHECK_SERVICES
  then
    healthy=true
    break
  fi
  sleep 2
done
if ! "$healthy"; then echo "The Jude web or voice process failed its local readiness check." >&2; exit 1; fi

docker run -d --name jude-proxy --network jude --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --sysctl net.ipv4.ip_unprivileged_port_start=0 -p 80:80 -p 443:443 \
  -e "JUDE_HOST=$JUDE_HOST" -e XDG_DATA_HOME=/data -e XDG_CONFIG_HOME=/config \
  --mount type=bind,src=/etc/jude/Caddyfile,dst=/etc/caddy/Caddyfile,readonly \
  --mount type=bind,src=/var/lib/jude/caddy/data,dst=/data \
  --mount type=bind,src=/var/lib/jude/caddy/config,dst=/config \
  --log-opt max-size=10m --log-opt max-file=3 \
  "$image" caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
