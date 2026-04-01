import { timingSafeEqual } from "node:crypto";

/**
 * Layer 1: Owner API Key authentication
 *
 * Validates Bearer token against stored owner API keys.
 * Reference: cross-claude-mcp MCP_API_KEY pattern
 */

export interface ApiKeyStore {
  findOwnerByApiKey(apiKey: string): Promise<{ ownerId: string } | null>;
}

export async function validateApiKey(
  token: string,
  store: ApiKeyStore,
): Promise<{ ownerId: string } | null> {
  return store.findOwnerByApiKey(token);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Reference: openclaw-a2a-gateway security.ts
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return timingSafeEqual(bufA, bufB);
}
