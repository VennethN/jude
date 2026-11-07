#!/usr/bin/env python3
"""Deploy the CI-built release by digest through SSM, without SSH or runtime secrets."""

import json
import os
import re
import shlex
import subprocess
import tempfile
import time


def setting(name, pattern):
    value = os.environ.get(name, "")
    if not re.fullmatch(pattern, value):
        raise ValueError(f"Invalid or missing {name}")
    return value


def aws(*args):
    result = subprocess.run(
        ["aws", *args, "--output", "json"], check=True, capture_output=True, text=True
    )
    return json.loads(result.stdout)


def main():
    region = setting("AWS_REGION", r"ap-southeast-3")
    instance = setting("DEPLOY_INSTANCE_ID", r"i-[a-f0-9]{17}")
    bucket = setting("DEPLOY_OPS_BUCKET", r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]")
    image = setting(
        "JUDE_IMAGE",
        r"[0-9]{12}\.dkr\.ecr\.ap-southeast-3\.amazonaws\.com/[a-z0-9/_-]+@sha256:[a-f0-9]{64}",
    )
    run = setting("GITHUB_RUN_ID", r"[0-9]+")
    attempt = setting("GITHUB_RUN_ATTEMPT", r"[0-9]+")
    registry = image.split("/")[0]
    quote = shlex.quote
    commands = [
        "set -eu",
        "cloud-init status --wait >/dev/null",
        "install -d -m 0700 /opt/jude",
        # Authenticate and pull before touching either running container.
        f"export AWS_DEFAULT_REGION={quote(region)} AWS_PAGER=''",
        "export DOCKER_CONFIG=$(mktemp -d /run/jude-ecr.XXXXXX)",
        "trap 'rm -rf -- \"$DOCKER_CONFIG\"' EXIT",
        f"aws ecr get-login-password | docker login --username AWS --password-stdin {quote(registry)}",
        f"docker pull {quote(image)}",
        f"aws s3 cp {quote(f's3://{bucket}/_deploy/releases/{run}-{attempt}/run.sh')} /opt/jude/run.sh --only-show-errors",
        f"aws s3 cp {quote(f's3://{bucket}/_deploy/releases/{run}-{attempt}/voice-gateway.sh')} /opt/jude/run-direct-voice.sh --only-show-errors",
        "chmod 0700 /opt/jude/run.sh /opt/jude/run-direct-voice.sh",
        f"JUDE_IMAGE={quote(image)} /opt/jude/run.sh",
        f"if grep -q '^JUDE_VOICE_PUBLIC_HOST=.' /run/jude/app.env; then JUDE_IMAGE={quote(image)} /opt/jude/run-direct-voice.sh; fi",
    ]
    payload = {
        "InstanceIds": [instance],
        "DocumentName": "AWS-RunShellScript",
        "Comment": f"Jude GitHub Actions {run}/{attempt}",
        "TimeoutSeconds": 1200,
        "Parameters": {"commands": commands, "executionTimeout": ["1200"]},
    }
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".json") as data:
        json.dump(payload, data)
        data.flush()
        command_id = aws("ssm", "send-command", "--cli-input-json", f"file://{data.name}")["Command"]["CommandId"]
    print(f"SSM command {command_id}", flush=True)
    for _ in range(125):
        try:
            invocation = aws("ssm", "get-command-invocation", "--command-id", command_id, "--instance-id", instance)
        except subprocess.CalledProcessError as error:
            if "InvocationDoesNotExist" not in error.stderr:
                raise
            time.sleep(10)
            continue
        status = invocation["Status"]
        if status in {"Pending", "InProgress", "Delayed"}:
            time.sleep(10)
            continue
        print(f"Deployment status: {status}", flush=True)
        if status != "Success":
            raise RuntimeError(f"Deployment failed; inspect SSM command {command_id}")
        return
    raise TimeoutError(f"Deployment timed out; inspect SSM command {command_id}")


if __name__ == "__main__":
    main()
