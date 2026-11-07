#!/usr/bin/env python3
"""Build on the Jakarta EC2 host and configure runtime through SSM only.

Run build while RDS is provisioning, then configure after Terraform completes.
The configure command requires psycopg in the local Python environment.
Credential values stay in process memory, private temporary files and SSM.
"""
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import tempfile
from urllib.parse import quote
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REGION = "ap-southeast-3"


def command(args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout


def aws(service, operation, payload=None, args=()):
    cli = ["aws", "--region", REGION, service, operation, "--output", "json", *args]
    if payload is None:
        output = command(cli)
        return json.loads(output) if output.strip() else {}
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".json") as data:
        json.dump(payload, data)
        data.flush()
        output = command([*cli, "--cli-input-json", "file://" + data.name])
        return json.loads(output) if output.strip() else {}


def identity():
    records = aws("ec2", "describe-instances", args=["--filters", "Name=tag:Name,Values=jude-dev-voice", "Name=instance-state-name,Values=running"])
    instances = [i for r in records["Reservations"] for i in r["Instances"]]
    if len(instances) != 1:
        raise RuntimeError("Expected one running Jude voice instance")
    buckets = [b["Name"] for b in aws("s3api", "list-buckets")["Buckets"] if b["Name"].startswith("jude-dev-files-")]
    if len(buckets) != 1:
        raise RuntimeError("Expected one Jude files bucket")
    return instances[0]["InstanceId"], buckets[0]


def send(instance, commands, comment, timeout="3600"):
    result = aws("ssm", "send-command", {
        "InstanceIds": [instance], "DocumentName": "AWS-RunShellScript", "Comment": comment,
        "Parameters": {"commands": commands, "executionTimeout": [timeout]},
    })
    print(json.dumps({"instanceId": instance, "commandId": result["Command"]["CommandId"]}))


def build():
    instance, bucket = identity()
    sha = command(["git", "rev-parse", "HEAD"]).strip()
    with tempfile.NamedTemporaryFile(suffix=".tar.gz") as archive:
        subprocess.run(["git", "archive", "--format=tar.gz", "--output=" + archive.name, sha], cwd=ROOT, check=True)
        key = "_deploy/source-" + sha + ".tar.gz"
        command(["aws", "--region", REGION, "s3", "cp", archive.name, "s3://" + bucket + "/" + key, "--only-show-errors"])
    send(instance, ["set -euo pipefail", "cloud-init status --wait >/dev/null",
        "install -d -m 0700 /opt/jude/source",
        f"aws s3 cp s3://{bucket}/{key} /opt/jude/source.tar.gz --region {REGION} --only-show-errors",
        "tar -xzf /opt/jude/source.tar.gz -C /opt/jude/source",
        "cd /opt/jude/source",
        "docker build -f infra/docker/Dockerfile --target release-pyannote -t jude:current . > /opt/jude/build.log 2>&1 || { tail -100 /opt/jude/build.log; exit 1; }",
        "echo 'Linux web and pyannote voice image built successfully'"], "Build Jude web and Python voice " + sha[:12])


def put(name, value):
    path = "/jude-dev/runtime/" + name
    aws("ssm", "put-parameter", {"Name": path, "Value": value, "Type": "SecureString", "Overwrite": True})
    aws("ssm", "add-tags-to-resource", {"ResourceType": "Parameter", "ResourceId": path,
        "Tags": [{"Key": "Project", "Value": "jude"}, {"Key": "Environment", "Value": "dev"},
                 {"Key": "Hackathon", "Value": "true"}, {"Key": "ManagedBy", "Value": "jude-runtime"}]})


def configure():
    import psycopg
    from psycopg import sql

    outputs = json.loads(command(["terraform", "-chdir=infra/terraform", "output", "-json"]))
    values = {key: item["value"] for key, item in outputs.items()}
    host, port = values["db_endpoint"].split(":")
    credentials = json.loads(aws("secretsmanager", "get-secret-value", {"SecretId": values["db_master_secret_arn"]})["SecretString"])
    try:
        existing = aws("ssm", "get-parameter", {"Name": "/jude-dev/runtime/DATABASE_URL", "WithDecryption": True})["Parameter"]["Value"]
        from urllib.parse import urlparse, unquote
        password = unquote(urlparse(existing).password)
    except RuntimeError as error:
        if "ParameterNotFound" not in str(error):
            raise
        password = secrets.token_urlsafe(36)
    with tempfile.NamedTemporaryFile() as cert:
        with urllib.request.urlopen(f"https://truststore.pki.rds.amazonaws.com/{REGION}/{REGION}-bundle.pem") as response:
            cert.write(response.read())
        cert.flush()
        with psycopg.connect(host=host, port=port, dbname=values["db_name"], user=credentials["username"], password=credentials["password"], sslmode="verify-full", sslrootcert=cert.name, autocommit=True) as connection:
            if connection.execute("SELECT 1 FROM pg_roles WHERE rolname='jude_app'").fetchone() is None:
                connection.execute(sql.SQL("CREATE ROLE jude_app LOGIN PASSWORD {}").format(sql.Literal(password)))
            connection.execute("GRANT CONNECT, CREATE ON DATABASE app TO jude_app")
            connection.execute("GRANT USAGE, CREATE ON SCHEMA public TO jude_app")
    put("DATABASE_URL", f"postgresql://jude_app:{quote(password, safe='')}@{host}:{port}/app?sslmode=verify-full&sslrootcert=/run/rds-ca.pem")
    for name, value in {
        "ORIGIN": values["voice_web_url"], "WEB_ORIGIN": values["voice_web_url"],
        "AWS_REGION": REGION, "JUDE_S3_BUCKET": values["voice_files_bucket"],
        "JUDE_S3_KMS_KEY": values["voice_files_key"],
    }.items():
        put(name, value)
    instance, _ = identity()
    import base64
    script = base64.b64encode((ROOT / "infra/deploy/run-voice-host.sh").read_bytes()).decode("ascii")
    send(instance, ["set -euo pipefail", f"printf %s {script} | base64 -d > /opt/jude/run.sh", "chmod 700 /opt/jude/run.sh", "/opt/jude/run.sh"], "Configure Jude web and voice from SSM", "300")
    print(json.dumps({"url": values["voice_web_url"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["build", "configure"])
    arguments = parser.parse_args()
    {"build": build, "configure": configure}[arguments.stage]()
