#!/usr/bin/env bash
# Run on the EC2 host through SSM after granting access to Community-1.
# Only the downloader receives HF_TOKEN; the application uses an offline snapshot.
set -euo pipefail
umask 077
export AWS_DEFAULT_REGION=ap-southeast-3 AWS_PAGER=""
image=${JUDE_IMAGE:-$(docker inspect --format '{{.Image}}' jude-app)}
destination=/var/lib/jude/models/community-1
if [[ -e "$destination" ]]; then
  echo 'Model directory already exists; refusing to overwrite it.' >&2
  exit 1
fi
install -d -m 0755 /var/lib/jude/models
work=$(mktemp -d /var/lib/jude/models/.community-1.XXXXXX)
credentials=$(mktemp /run/jude-hf.XXXXXX)
cleanup() { rm -rf -- "$work"; rm -f -- "$credentials"; }
trap cleanup EXIT
chmod 0755 "$work"
install -d -m 0755 -o 1000 -g 1000 "$work/snapshot"
aws ssm get-parameter --name /jude-dev/runtime/HF_TOKEN --with-decryption --output json |
  jq -er '.Parameter.Value | if test("^hf_[A-Za-z0-9]+$") then "HF_TOKEN=\(.)" else error("Invalid Hugging Face token") end' > "$credentials"
docker run --rm -i --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=512m --env-file "$credentials" \
  -e HOME=/tmp -e HF_HOME=/tmp/huggingface -e HF_HUB_DISABLE_TELEMETRY=1 \
  --mount "type=bind,src=$work/snapshot,dst=/models/community-1" "$image" python - <<'PY'
import os
import sys
from huggingface_hub import snapshot_download
from jude_voice.diarization import MODEL_ID, MODEL_REVISION

try:
    snapshot_download(repo_id=MODEL_ID, revision=MODEL_REVISION,
                      token=os.environ["HF_TOKEN"], local_dir="/models/community-1")
except Exception:
    print("Model download failed. Check gated model access, token permissions and network.", file=sys.stderr)
    sys.exit(1)
print("Pinned Community-1 snapshot downloaded.")
PY
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=512m -e HOME=/tmp \
  -e HF_HUB_OFFLINE=1 -e PYANNOTE_METRICS_ENABLED=0 \
  --mount "type=bind,src=$work/snapshot,dst=/models/community-1,readonly" "$image" python -c \
  'from pyannote.audio import Pipeline; Pipeline.from_pretrained("/models/community-1"); print("Offline model load verified")'
mv "$work/snapshot" "$destination"
echo 'Model installed. Set /jude-dev/runtime/JUDE_DIARIZATION_MODEL to /models/community-1 and redeploy.'
echo 'Remove the temporary HF_TOKEN parameter after successful provisioning.'
