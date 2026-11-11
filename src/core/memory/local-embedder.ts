import { pipeline, env } from '@xenova/transformers';

// Configure transformers environment for local Node.js runtime
env.allowLocalModels = true;
env.useBrowserCache = false;

export const EMBEDDING_DIMENSION = 384;
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

// Type definition for feature extraction pipeline output
type FeatureExtractor = (
  text: string | string[],
  options?: { pooling?: string; normalize?: boolean }
) => Promise<{ data: Float32Array | number[]; dims?: number[] }>;

declare global {
  // eslint-disable-next-line no-var
  var __agentEmbedderPipeline: Promise<FeatureExtractor> | undefined;
  // eslint-disable-next-line no-var
  var __agentEmbedderOfflineMode: boolean | undefined;
}

/**
 * Initializes and caches the local ONNX embedding pipeline.
 */
async function getPipeline(): Promise<FeatureExtractor> {
  if (globalThis.__agentEmbedderOfflineMode) {
    throw new Error('Embedder running in offline fallback mode.');
  }

  if (!globalThis.__agentEmbedderPipeline) {
    globalThis.__agentEmbedderPipeline = (async () => {
      try {
        const extractor = await pipeline('feature-extraction', MODEL_NAME, {
          quantized: true,
        });
        return extractor as unknown as FeatureExtractor;
      } catch (err) {
        console.warn(
          `[LocalEmbedder] Could not download/load ${MODEL_NAME}. Activating fast lexical fallback embedder.`,
          err instanceof Error ? err.message : String(err)
        );
        globalThis.__agentEmbedderOfflineMode = true;
        throw err;
      }
    })();
  }

  return globalThis.__agentEmbedderPipeline;
}

export class LocalEmbedder {
  /**
   * Generates a normalized 384-dimensional Float32Array embedding for input text.
   * If the local ONNX model fails or is offline, falls back gracefully to a deterministic
   * 384-dimensional lexical feature embedding.
   */
  public static async embed(text: string): Promise<Float32Array> {
    if (!text || text.trim().length === 0) {
      return new Float32Array(EMBEDDING_DIMENSION);
    }

    try {
      const extractor = await getPipeline();
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      const rawData = output.data;
      if (rawData instanceof Float32Array) {
        return rawData.length === EMBEDDING_DIMENSION
          ? rawData
          : rawData.slice(0, EMBEDDING_DIMENSION);
      }
      return new Float32Array(Array.from(rawData).slice(0, EMBEDDING_DIMENSION));
    } catch {
      return this.generateLexicalFallbackEmbedding(text);
    }
  }

  /**
   * Deterministic 384-dimensional lexical/hash embedding with L2 normalization.
   * Ensures that even in completely offline, firewalled, or low-memory environments,
   * vector search never fails or halts the chat agent.
   */
  public static generateLexicalFallbackEmbedding(text: string): Float32Array {
    const vec = new Float32Array(EMBEDDING_DIMENSION);
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);

    if (tokens.length === 0) return vec;

    for (const token of tokens) {
      let h1 = 0x811c9dc5;
      let h2 = 0x5bd1e995;
      for (let i = 0; i < token.length; i++) {
        const code = token.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 0x01000193);
        h2 = Math.imul(h2 ^ (code * (i + 1)), 0x5bd1e995);
      }

      const idx1 = Math.abs(h1) % EMBEDDING_DIMENSION;
      const sign1 = (h2 & 1) === 0 ? 1 : -1;
      const weight = 1 + Math.log(1 + token.length);

      vec[idx1] += sign1 * weight;

      // Secondary feature projection for dimensionality spread
      const idx2 = Math.abs(h2) % EMBEDDING_DIMENSION;
      vec[idx2] += -sign1 * (weight * 0.5);
    }

    // L2 normalization: ||v|| = 1.0
    let norm = 0;
    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
        vec[i] /= norm;
      }
    }

    return vec;
  }

  /**
   * Calculates cosine similarity between two Float32Array vectors.
   */
  public static cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i];
      const bi = b[i];
      dot += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Converts Float32Array vector into a Buffer for SQLite BLOB storage.
   */
  public static vectorToBlob(vector: Float32Array): Buffer {
    return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  }

  /**
   * Converts a SQLite BLOB Buffer back into a Float32Array.
   */
  public static blobToVector(blob: Buffer): Float32Array {
    return new Float32Array(
      blob.buffer,
      blob.byteOffset,
      blob.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
  }
}

