import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { originalsDirectory } from '../workspace-paths';

let s3: S3Client | undefined;
const client = () => (s3 ??= new S3Client({ region: process.env.AWS_REGION ?? 'ap-southeast-3' }));
function privatePath(key: string) {
  const root = resolve(originalsDirectory());
  if (!key || key.split('/').some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '..' || part === '.'))
    throw new Error('Invalid storage key.');
  const path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error('Invalid storage key.');
  return path;
}
export async function putOriginal(key: string, bytes: Uint8Array, contentType: string) {
  const path = privatePath(key),
    bucket = process.env.JUDE_S3_BUCKET;
  if (bucket) {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: process.env.JUDE_S3_KMS_KEY,
      }),
    );
    return;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.' + randomUUID();
  try {
    await writeFile(temp, bytes, { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
export async function getOriginal(key: string): Promise<Uint8Array> {
  const path = privatePath(key),
    bucket = process.env.JUDE_S3_BUCKET;
  if (!bucket) return readFile(path);
  const result = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error('Missing original.');
  return result.Body.transformToByteArray();
}
export async function originalURL(key: string) {
  privatePath(key);
  return process.env.JUDE_S3_BUCKET
    ? getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.JUDE_S3_BUCKET, Key: key }), {
        expiresIn: 90,
      })
    : null;
}
export async function removeOriginal(key: string) {
  const path = privatePath(key),
    bucket = process.env.JUDE_S3_BUCKET;
  if (bucket) {
    await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }
  await rm(path, { force: true });
}
