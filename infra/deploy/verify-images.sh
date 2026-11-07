#!/usr/bin/env bash
set -euo pipefail

# Exercise local release images against a disposable PostgreSQL database.
web_image=${1:-jude-web:release}
voice_image=${2:-jude-voice:release}
combined_image=${3:-jude:release}
platform=${JUDE_SMOKE_PLATFORM:-linux/amd64}
checks=$(cd "$(dirname "$0")" && pwd)/verify-runtime.mjs

for image in "$web_image" "$voice_image" "$combined_image"; do
  docker image inspect "$image" >/dev/null
done
network=$(docker network create --internal "jude-verify-$$")
containers=()
clean_up() {
  set +u
  for id in "${containers[@]}"; do docker stop -t 2 "$id" >/dev/null 2>&1 || true; done
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap clean_up EXIT

password=$(openssl rand -hex 24)
postgres=$(docker run --rm -d --network "$network" --network-alias database \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=256m \
  -e "POSTGRES_PASSWORD=$password" -e POSTGRES_DB=app postgres:17-alpine)
containers+=("$postgres")
for attempt in {1..45}; do
  if docker exec "$postgres" pg_isready -h 127.0.0.1 -d app >/dev/null; then break; fi
  sleep 1
done
docker exec -i "$postgres" psql -v ON_ERROR_STOP=1 -v "app_password=$password" -U postgres -d app <<'SQL'
CREATE ROLE jude_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE app TO jude_app;
GRANT USAGE, CREATE ON SCHEMA public TO jude_app;
SQL

environment=(--platform "$platform" --network "$network" --read-only
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=200m -e ORIGIN=http://127.0.0.1:3000
  -e "DATABASE_URL=postgresql://jude_app:$password@database:5432/app")
voice=$(docker run --rm -d "${environment[@]}" --network-alias voice "$voice_image")
containers+=("$voice")
web=$(docker run --rm -d "${environment[@]}" -e VOICE_ORIGIN=http://voice:3001 \
  -e SMOKE_STANDALONE=1 "$web_image")
containers+=("$web")
if ! docker exec -i "$web" node --input-type=module - < "$checks"; then
  docker logs --tail=20 "$web"
  docker logs --tail=20 "$voice"
  exit 1
fi
docker exec -i "$voice" python - <<'PYTHON'
import os
import shutil
from pathlib import Path

assert os.getuid() != 0
assert shutil.which("node") is None
assert not Path("/app/apps/web").exists()
assert Path("/app/packages/core/src/plan-quotas.json").is_file()
PYTHON

combined=$(docker run --rm -d "${environment[@]}" "$combined_image")
containers+=("$combined")
if ! docker exec -i "$combined" node --input-type=module - < "$checks"; then
  docker logs --tail=20 "$combined"
  exit 1
fi
