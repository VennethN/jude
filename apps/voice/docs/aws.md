# Hosting the voice service

The voice application runs its own Node HTTP and WebSocket process. Use the default `release` container on the existing EC2 host to start it alongside the web process. For separate hosts or services, build the `voice` and `web` Docker targets from the repository root.

```sh
docker buildx build --platform linux/amd64 --target voice --tag jude-voice:release --load .
docker buildx build --platform linux/amd64 --target web --tag jude-web:release --load .
```

The voice image runs `node apps/voice/dist/server.mjs`. Its default `VOICE_PORT` is 3001. Put it on an internal container network or private subnet. Set `VOICE_ORIGIN` on the web service to a reachable internal URL such as `http://jude-voice:3001`. Browser traffic for `/api/live/**` goes through the public web origin, including WebSocket upgrades. Configure `ORIGIN` with the same public HTTPS URL on both processes.

Both processes need the same PostgreSQL database, S3 originals bucket and KMS key, an IAM identity with access to those objects, and the same application migrations. The voice service reads OpenAI credentials at runtime for private-case transcription. The synthetic hearing runs without a provider key. Keep provider credentials in the service's secret store. Forward websockets, streaming HTTP and session cookies through the web ingress.

For a split deployment, use stable internal voice DNS and permit the voice port from the web tier. Assign web and voice their own process supervision, health checks and log streams. Release a compatible web and voice pair together. Under the combined EC2 release, Caddy forwards public HTTPS to the web application, and the two Node processes communicate over loopback inside their container.

The [AWS environment guide](../../web/docs/aws.md) covers Jakarta infrastructure, database permissions, TLS certificates, the private registry, runtime secrets, releases and recovery.
