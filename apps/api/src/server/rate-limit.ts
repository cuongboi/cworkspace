/**
 * In-memory token bucket, per process. Good for a single Node instance; move the state to Redis
 * when running more than one instance.
 */
type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

/** Returns true if the call identified by `key` is allowed (capacity tokens per `perMs`). */
export function rateLimit(key: string, capacity: number, perMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updatedAt) / perMs) * capacity);
  bucket.updatedAt = now;
  const allowed = bucket.tokens >= 1;
  if (allowed) bucket.tokens -= 1;
  buckets.set(key, bucket);
  if (buckets.size > 50_000) {
    // drop idle buckets so memory stays bounded
    for (const [k, b] of buckets) if (now - b.updatedAt > perMs * 10) buckets.delete(k);
  }
  return allowed;
}
