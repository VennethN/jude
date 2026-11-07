# Hosting Jude on AWS

Jude runs on one Amazon Linux 2023 EC2 instance in Jakarta. Caddy terminates HTTPS and proxies HTTP, event streams and WebSockets to the web service over a private Docker network. The combined EC2 release runs the Node web application and the Python voice service as separate processes. The application uses the existing RDS PostgreSQL instance, writes originals to a private S3 bucket encrypted with a rotating KMS key, and calls OpenAI directly when a key is configured.

Run the following commands from the repository root. Cloud commands in this guide use the operator’s AWS identity. Set `AWS_REGION=ap-southeast-3` in that shell.

## Prepare the environment

The database configuration can run by itself. The application resources are opt-in and Terraform keeps the registry, the application secret and the Elastic IP address available before the first image is built.

Add these variables to your environment’s Terraform configuration.

```hcl
enable_application = true
app_hostname       = "jude.example.org"
# Set app_image_digest after publishing the image.
```

Review the existing `db_publicly_accessible` and `db_allowed_public_cidrs` values with the database owner. The web instance uses the existing database-client security group and can reach a private database on port 5432. The application subnet has its own internet route.

```sh
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform plan -out=hosting.tfplan
terraform -chdir=infra/terraform apply hosting.tfplan
terraform -chdir=infra/terraform output -raw app_public_ip
terraform -chdir=infra/terraform output -raw app_registry
terraform -chdir=infra/terraform output -raw app_secret_arn
```

Create a DNS A record for `app_hostname` pointing to `app_public_ip`. The baseline uses IPv4. Ports 80 and 443 receive certificate validation and HTTPS traffic. Session Manager provides host administration.

## Configure the application identity

From a trusted database administration connection, create a login in the existing `app` database. Use an interactive password prompt. The application role owns the tables created by its startup migrations.

```sql
CREATE ROLE jude_app LOGIN;
\password jude_app
GRANT CONNECT ON DATABASE app TO jude_app;
GRANT USAGE, CREATE ON SCHEMA public TO jude_app;
```

In Secrets Manager, open the secret named by `app_secret_arn` and store a JSON object. Set `DATABASE_URL` to the following URI shape, URL-encoding the application password. Replace the RDS endpoint with the hostname from `db_endpoint`. The runtime mounts the regional RDS CA bundle at `/run/rds-ca.pem`.

```text
postgresql://jude_app:URL_ENCODED_PASSWORD@RDS_HOST:5432/app?sslmode=verify-full&sslrootcert=/run/rds-ca.pem
```

The other values are optional single-line strings.

| Key | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables configured OpenAI models. Live and uploaded speech also require the pyannote image and Community-1 weights. |
| `OPENAI_PROJECT_ID` | Selects the OpenAI project used for requests. |
| `JUDE_PASAL_TOKEN` | Enables server-side regulation discovery in private cases. The token stays in the web runtime. |
| `OPENAI_MODEL`, `OPENAI_ASSISTANT_MODEL`, `OPENAI_ANALYSIS_MODEL`, `OPENAI_REVIEW_MODEL`, `OPENAI_NOTES_MODEL`, `OPENAI_TRANSCRIPTION_MODEL` | Override individual model routes. The default text model is `gpt-6.1-sol`. |
| `OPENAI_EMBEDDING_MODEL`, `JUDE_SEMANTIC_SEARCH` | Private evidence uses `text-embedding-3-small` on PostgreSQL. Set the search flag to `false` to opt out. RDS supports native cosine search. A database administrator can optionally enable pgvector with `CREATE EXTENSION IF NOT EXISTS vector`. |
| `JUDE_MAIL_FROM` | Verified SES sender for invitations and resets. Set the matching `app_mail_identity_arn` Terraform variable. |
| `JUDE_DIARIZATION_MODEL`, `JUDE_DIARIZATION_TIMEOUT_MS` | Optional local speaker diarization. Publish the pyannote target and provision the model as described in the voice guide. |
| `JUDE_DELETE_GRACE_DAYS` | Retention interval for deleted cases, in days. |

The instance profile reads the application secret and release digest, pulls from the environment’s ECR repository, and accesses this environment’s S3 objects and their KMS key. The RDS master secret stays with the database administrator. Application secret values stay outside Terraform state and EC2 user data.

## Build and release

Build an x86-64 Linux image for the default EC2 instance. The default `release` image starts the Node web and Python voice processes with `node scripts/start.mjs`. It includes migrations, synthetic originals, OCR language packs, PDF tools, LibreOffice and ffmpeg. This target supports synthetic replay and authorised playback of retained hearings. For new live or uploaded speech, build with `--target release-pyannote`, provision the Community-1 weights and set the OpenAI API key. Use a unique image tag for each release.

```sh
repository=$(terraform -chdir=infra/terraform output -raw app_registry)
registry=${repository%%/*}
revision=$(git rev-parse HEAD)
aws ecr get-login-password --region ap-southeast-3 | docker login --username AWS --password-stdin "$registry"
docker buildx build -f infra/docker/Dockerfile --platform linux/amd64 --tag "$repository:$revision" --push .
aws ecr describe-images --region ap-southeast-3 --repository-name "${repository#*/}" --image-ids "imageTag=$revision" --query 'imageDetails[0].imageDigest' --output text
```

Set `app_image_digest` to that `sha256:…` value, review a fresh Terraform plan, then apply it to launch the host. The default instance type is `t3.medium`. The first boot installs Docker, fetches the digest and application settings, verifies the database through `/healthz`, then starts Caddy. Its automatic certificate flow requires the public DNS record to resolve to the Elastic IP.

```sh
curl --fail https://jude.example.org/healthz
aws ssm start-session --region ap-southeast-3 --target "$(terraform -chdir=infra/terraform output -raw app_instance_id)"
```

Inside the SSM session, use `sudo systemctl status jude`, `sudo journalctl -u jude`, `sudo docker logs jude-app`, and `sudo docker logs jude-proxy` to diagnose startup. A host with a missing application secret retries startup every 30 seconds.

## Running the web service independently

The `web` Docker target contains the SvelteKit build and its Node entry point. Start it with `node apps/web/server.mjs` from the workspace root. It listens on `PORT` (3000 by default). Supply the same database, origins, storage configuration and runtime secrets as the combined service. `/healthz` checks database readiness. Set `VOICE_ORIGIN` to an internal voice HTTP origin to enable proxied live endpoints and WebSockets.

```sh
docker buildx build -f infra/docker/Dockerfile --platform linux/amd64 --target web --tag jude-web:release --load .
```

The independent voice process, Docker target, and streaming route are described in the [voice deployment guide](../../voice/docs/aws.md).

## Verify the release images locally

Build the `web`, `voice` and `release` targets with `--load`, then pass their local tags to the smoke check. It starts disposable PostgreSQL 17 on an isolated Docker network, opens a guest case and advances its synthetic hearing through Python voice. The check reads the new transcript and server-sent event through web, exercises WebSocket admission, and repeats the run with the combined release. It removes its containers and network on exit.

```sh
bash infra/deploy/verify-images.sh jude-web:release jude-voice:release jude:release
```

## Subsequent releases and recovery

Push the next immutable image, update `app_image_digest`, review and apply the plan, then run `sudo systemctl reload jude` through Session Manager. A reload retrieves and checks the release settings before replacing the running containers. Apply secret rotations the same way. Each release briefly restarts the single web host’s containers. Check `/healthz` and open an original document afterwards.

To roll back application code, restore a previously published digest and restart the service. Confirm that its database schema is compatible with migrations already applied. Database recovery uses the existing RDS backup and point-in-time restore policy. Maintain your organisation’s S3 backup and retention policy for case originals.

Caddy stores its ACME account and certificates under `/var/lib/jude/caddy` on the encrypted root disk. A replacement host obtains certificates again. The AMI stays fixed during regular release changes. Review a planned host replacement when updating the base operating system.

Run the offline module checks locally with `terraform -chdir=infra/terraform fmt -check -recursive`, `terraform -chdir=infra/terraform validate` and `terraform -chdir=infra/terraform test` after initialization. The application tests use a mocked AWS provider.

AWS documents the [Amazon Linux 2023 image parameters](https://docs.aws.amazon.com/linux/al2023/ug/ec2.html) and [RDS certificate rotation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ConnectToInstance.SSL.CertificateRotation.html).

The shared hosting and network diagrams are in the [infrastructure documentation](../../../infra/docs/architecture/).

## GitHub Actions

`.github/workflows/deploy.yml` follows the reference project's web/voice/deploy jobs. Web checks include SQLite, PostgreSQL and browser coverage; the independent Python job checks lint and both database backends. Only successful main runs deploy, using OIDC, ECR and SSM. The shared image contains both apps and migrations, built from the repository root with the `release-pyannote` target. ECR tags identify each workflow attempt because the repository is immutable; EC2 pulls the returned digest before replacing containers. Runtime credentials stay in SSM.

Apply Terraform with `github_repository = "VennethN/jude"` to provision the dedicated deployment role and host ECR read permissions. The AWS account must already have the GitHub OIDC provider `token.actions.githubusercontent.com`. Set `github_oidc_subject_prefix` to `sub_claim_prefix` returned by `gh api repos/VennethN/jude/actions/oidc/customization/sub`. This repository uses immutable owner and repository IDs; a legacy name-only subject will be rejected. The workflow reads repository Actions Secrets `AWS_DEPLOY_ROLE_ARN` (Terraform output `github_deploy_role_arn`), `AWS_REGION`, `ECR_REPOSITORY`, `DEPLOY_OPS_BUCKET`, `DEPLOY_INSTANCE_ID` and `APP_URL`. Configure them with `gh secret set NAME --repo VennethN/jude`. No AWS access keys or application runtime credentials are stored in GitHub; OIDC authenticates the workflow and runtime credentials stay in SSM. A manual main run is available through workflow_dispatch.

A deployment briefly replaces the two containers on the single host. Failed readiness stops the workflow; it does not automatically restore the preceding image. Inspect the SSM command ID reported by the workflow before retrying.
