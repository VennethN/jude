#!/usr/bin/env python3
"""Deploy the current GitHub main web source to an Amplify SSR test app.

No git push, database provisioning, runtime credentials or voice deployment.
The packaging command is included in Amplify's build settings, so local build
configuration does not need to be pushed before this one-off test deployment.
"""
import base64
import json
from pathlib import Path
import subprocess
import sys
import time

REGION = "ap-southeast-1"
NAME = "jude-web-test"
REPOSITORY = "https://github.com/VennethN/jude"
ROLE = "jude-amplify-web-test-service"
ROOT = Path(__file__).resolve().parents[2]
TOKEN = ""


def command(args, payload=None):
    result = subprocess.run(args, input=None if payload is None else json.dumps(payload),
                            capture_output=True, text=True, cwd=ROOT)
    if result.returncode:
        message = result.stderr.replace(TOKEN, "[redacted]") if TOKEN else result.stderr
        raise RuntimeError(message.strip())
    return json.loads(result.stdout) if result.stdout.strip() else {}


def aws(service, operation, payload=None, args=()):
    cli = ["aws", "--region", REGION, "--cli-connect-timeout", "10", "--cli-read-timeout", "30",
           service, operation, "--output", "json", *args]
    if payload is not None:
        cli += ["--cli-input-json", "file:///dev/stdin"]
    return command(cli, payload)


def find_app():
    apps = [a for a in aws("amplify", "list-apps")["apps"] if a["name"] == NAME]
    if len(apps) > 1:
        raise RuntimeError("Multiple test apps found; resolve app identity before deploying.")
    if apps and apps[0].get("repository") not in (None, "", REPOSITORY):
        raise RuntimeError("The existing test app uses a different repository.")
    return apps[0] if apps else None


def main():
    global TOKEN
    who = command(["gh", "api", "user"])
    if who["login"] != "svviitzerland":
        raise RuntimeError("The active GitHub identity must be svviitzerland.")
    account = aws("sts", "get-caller-identity")["Account"]
    tags = {"Project": "jude", "Environment": "test", "Hackathon": "true", "ManagedBy": "amplify-test-script"}
    trust = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "sts:AssumeRole",
             "Principal": {"Service": "amplify.amazonaws.com"},
             "Condition": {"StringEquals": {"aws:SourceAccount": account}}}]}
    try:
        role = aws("iam", "get-role", args=["--role-name", ROLE])["Role"]
    except RuntimeError as error:
        if "NoSuchEntity" not in str(error):
            raise
        role = aws("iam", "create-role", {
            "RoleName": ROLE, "AssumeRolePolicyDocument": json.dumps(trust),
            "Description": "CloudWatch logging for the Jude Amplify SSR test web app",
            "Tags": [{"Key": k, "Value": v} for k, v in tags.items()],
        })["Role"]
        print("Created the Amplify logging service role.", flush=True)
        time.sleep(10)
    policy = {"Version": "2012-10-17", "Statement": [
        {"Effect": "Allow", "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"],
         "Resource": f"arn:aws:logs:{REGION}:{account}:log-group:/aws/amplify/*"},
        {"Effect": "Allow", "Action": ["logs:DescribeLogGroups"], "Resource": "*"},
    ]}
    aws("iam", "put-role-policy", {"RoleName": ROLE, "PolicyName": "amplify-logging", "PolicyDocument": json.dumps(policy)})
    encoded = base64.b64encode((ROOT / "infra/scripts/package-amplify.mjs").read_bytes()).decode("ascii")
    build_spec = {"version": 1, "applications": [{"appRoot": "apps/web", "frontend": {
        "buildPath": "/", "phases": {
            "preBuild": {"commands": ["nvm install 24", "nvm use 24", "corepack enable",
                "corepack prepare pnpm@10.33.2 --activate", "pnpm install --frozen-lockfile"]},
            "build": {"commands": ["pnpm --filter @jude/web build",
                f'node --input-type=module -e "$(printf %s {encoded} | base64 --decode)"']},
        }, "artifacts": {"baseDirectory": ".amplify-hosting", "files": ["**/*"]},
    }}]}
    settings = {"buildSpec": json.dumps(build_spec), "platform": "WEB_COMPUTE", "iamServiceRoleArn": role["Arn"],
                "environmentVariables": {"AMPLIFY_MONOREPO_APP_ROOT": "apps/web"}}
    app = find_app()
    if app is None:
        token_result = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True)
        TOKEN = token_result.stdout.strip()
        if not TOKEN:
            raise RuntimeError("GitHub authorization is unavailable.")
        try:
            app = aws("amplify", "create-app", {"name": NAME, "repository": REPOSITORY,
                      "accessToken": TOKEN, "tags": tags, **settings})["app"]
        except RuntimeError:
            # Resolve an uncertain create before the next run could create a duplicate.
            existing = find_app()
            if existing:
                print("An app was created, but repository authorization or setup did not finish. App ID: " + existing["appId"], flush=True)
            raise
        finally:
            TOKEN = ""
    else:
        app = aws("amplify", "update-app", {"appId": app["appId"], **settings})["app"]
    app_id = app["appId"]
    url = "https://main." + app["defaultDomain"]
    aws("amplify", "update-app", {"appId": app_id, "environmentVariables": {
        "AMPLIFY_MONOREPO_APP_ROOT": "apps/web", "JUDE_WEB_ORIGIN": url,
    }})
    branches = aws("amplify", "list-branches", {"appId": app_id})["branches"]
    branch = {"appId": app_id, "branchName": "main", "framework": "SvelteKit", "stage": "DEVELOPMENT",
              "enableAutoBuild": False, "enablePullRequestPreview": False}
    aws("amplify", "update-branch" if any(b["branchName"] == "main" for b in branches) else "create-branch", branch)
    group = "/aws/amplify/" + app_id
    try:
        aws("logs", "create-log-group", {"logGroupName": group, "tags": tags})
    except RuntimeError as error:
        if "ResourceAlreadyExistsException" not in str(error):
            raise
    aws("logs", "put-retention-policy", {"logGroupName": group, "retentionInDays": 7})
    job = aws("amplify", "start-job", {"appId": app_id, "branchName": "main", "jobType": "RELEASE"})["jobSummary"]
    print(json.dumps({"appId": app_id, "jobId": job["jobId"], "url": url,
                      "console": f"https://{REGION}.console.aws.amazon.com/amplify/apps/{app_id}"}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
