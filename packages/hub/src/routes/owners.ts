import type { FastifyInstance } from "fastify";
import type { OwnerService } from "../services/owner.service.js";
import { getAuth } from "../auth/middleware.js";

const createOwnerRateLimit = new Map<string, number>(); // IP -> last create time

export function ownerRoutes(app: FastifyInstance, ownerService: OwnerService) {
  // Create owner (public endpoint)
  app.post("/api/owners", async (request, reply) => {
    // Rate limit: 1 creation per 10 seconds per IP
    const ip = request.ip;
    const lastCreate = createOwnerRateLimit.get(ip) ?? 0;
    if (Date.now() - lastCreate < 10000) {
      reply.code(429).send({ error: "Too many requests. Wait 10 seconds." });
      return;
    }
    createOwnerRateLimit.set(ip, Date.now());

    const body = request.body as { name: string; username?: string; password?: string };
    const name = body.name;
    if (!name) { reply.code(400).send({ error: "Name required" }); return; }

    const result = await ownerService.create(name, body.username, body.password);
    reply.code(201).send(result);
  });

  // Login with username + password (public)
  app.post("/api/owners/login", async (request, reply) => {
    const body = request.body as { username: string; password: string };
    if (!body.username || !body.password) {
      reply.code(400).send({ error: "Username and password required" });
      return;
    }

    const result = await ownerService.login(body.username, body.password);
    if (!result) {
      reply.code(401).send({ error: "Invalid username or password" });
      return;
    }

    reply.send({
      ownerId: result.ownerId,
      name: result.name,
      apiKey: result.apiKey,
    });
  });

  // Set password for existing owner
  app.post("/api/owners/set-password", async (request, reply) => {
    const auth = getAuth(request);
    if (!auth?.ownerId) { reply.code(401).send({ error: "Auth required" }); return; }

    const body = request.body as { username: string; password: string };
    if (!body.username || !body.password) {
      reply.code(400).send({ error: "Username and password required" });
      return;
    }
    if (body.password.length < 6) {
      reply.code(400).send({ error: "Password must be at least 6 characters" });
      return;
    }

    await ownerService.setPassword(auth.ownerId, body.username, body.password);
    reply.send({ message: "Password set successfully" });
  });

  // Change password (requires old password)
  app.post("/api/owners/change-password", async (request, reply) => {
    const auth = getAuth(request);
    if (!auth?.ownerId) { reply.code(401).send({ error: "Auth required" }); return; }

    const body = request.body as { oldPassword: string; newPassword: string };
    if (!body.oldPassword || !body.newPassword) {
      reply.code(400).send({ error: "Old and new password required" });
      return;
    }
    if (body.newPassword.length < 6) {
      reply.code(400).send({ error: "New password must be at least 6 characters" });
      return;
    }

    const success = await ownerService.changePassword(auth.ownerId, body.oldPassword, body.newPassword);
    if (!success) {
      reply.code(401).send({ error: "Old password is incorrect" });
      return;
    }
    reply.send({ message: "Password changed successfully" });
  });

  // Rotate API key
  app.post("/api/owners/rotate-key", async (request, reply) => {
    const auth = getAuth(request);
    if (!auth?.ownerId) {
      reply.code(401).send({ error: "Owner authentication required" });
      return;
    }
    const result = await ownerService.rotateApiKey(auth.ownerId);
    reply.send(result);
  });

  // Get current owner info (whoami)
  app.get("/api/owners/me", async (request, reply) => {
    const auth = getAuth(request);
    if (!auth?.ownerId) {
      reply.code(401).send({ error: "Owner authentication required" });
      return;
    }
    const owner = await ownerService.findById(auth.ownerId);
    if (!owner) {
      reply.code(404).send({ error: "Owner not found" });
      return;
    }
    return owner;
  });
}
