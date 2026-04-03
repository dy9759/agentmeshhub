import * as jose from "jose";
import type { AgentTokenPayload } from "./types.js";

/**
 * Layer 3: Agent Token (JWT)
 *
 * After registration, agents receive a short-lived JWT token.
 * This binds requests to a specific agentId, preventing impersonation.
 */

const ALG = "HS256";
const TOKEN_TTL = "1h";

let secret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (!secret) {
    const envSecret = process.env.AGENTMESH_JWT_SECRET;
    if (envSecret) {
      secret = new TextEncoder().encode(envSecret);
    } else {
      console.warn("[AUTH WARNING] AGENTMESH_JWT_SECRET not set — using random secret. All agent JWTs will be invalidated on server restart!");
      // Generate a random secret for dev mode (non-persistent)
      secret = crypto.getRandomValues(new Uint8Array(32));
    }
  }
  return secret;
}

export async function signAgentToken(
  agentId: string,
  ownerId: string,
  capabilities: string[],
): Promise<{ token: string; expiresIn: number }> {
  const token = await new jose.SignJWT({
    ownerId,
    capabilities,
  } satisfies Omit<AgentTokenPayload, "sub" | "iat" | "exp">)
    .setProtectedHeader({ alg: ALG })
    .setSubject(agentId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getSecret());

  return { token, expiresIn: 3600 };
}

export async function verifyAgentToken(
  token: string,
): Promise<AgentTokenPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getSecret());
    return {
      sub: payload.sub as string,
      ownerId: payload.ownerId as string,
      capabilities: payload.capabilities as string[],
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch {
    return null;
  }
}
