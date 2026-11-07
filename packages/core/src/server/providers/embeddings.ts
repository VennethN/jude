import { provider } from './openai';

export const embeddingModel = () => process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

export function embeddingsConfigured() {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.JUDE_SEMANTIC_SEARCH !== 'false';
}

export async function embedEvidence(texts: string[], signal?: AbortSignal, dimensions = 1536): Promise<number[][]> {
  if (!texts.length) return [];
  const client = embeddingsConfigured() && provider();
  if (!client) throw new Error('Evidence embeddings are unavailable');
  const response = await client.embeddings.create({
    model: embeddingModel(), dimensions, encoding_format: 'float', input: texts,
  }, { timeout: 12_000, maxRetries: 0, signal });
  const vectors = new Map<number, number[]>();
  for (const {index, embedding} of response.data) {
    if (!Number.isInteger(index) || index < 0 || index >= texts.length || vectors.has(index) ||
        embedding.length !== dimensions || !embedding.every(Number.isFinite) || !embedding.some(value => value !== 0)) {
      throw new Error('The embedding service returned an invalid vector');
    }
    vectors.set(index, embedding);
  }
  if (vectors.size !== texts.length) throw new Error('The embedding service returned an incomplete batch');
  return texts.map((_, index) => vectors.get(index)!);
}
