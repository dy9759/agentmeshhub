import type { FastifyInstance } from "fastify";
import type { FileService } from "../services/file.service.js";
import { getAuth } from "../auth/middleware.js";
import { createReadStream } from "node:fs";

export function fileRoutes(app: FastifyInstance, fileService: FileService) {
  // Upload file (multipart)
  app.post("/api/files", async (request, reply) => {
    const auth = getAuth(request);
    const fromAgentId = auth.agentId;
    if (!fromAgentId) {
      reply.code(400).send({ error: "Agent token required to upload files" });
      return;
    }

    const data = await request.file();
    if (!data) {
      reply.code(400).send({ error: "No file provided" });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const record = await fileService.upload(
      fromAgentId,
      auth.ownerId,
      data.filename,
      data.mimetype,
      buffer,
    );

    reply.code(201).send({
      id: record.id,
      fileName: record.fileName,
      contentType: record.contentType,
      size: record.size,
      expiresAt: record.expiresAt,
    });
  });

  // Download file
  app.get("/api/files/:fileId", async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const result = await fileService.download(fileId);

    if (!result) {
      reply.code(404).send({ error: "File not found" });
      return;
    }

    reply
      .header("Content-Type", result.contentType)
      .header("Content-Disposition", `attachment; filename="${result.fileName}"`)
      .send(createReadStream(result.filePath));
  });

  // Get file metadata
  app.get("/api/files/:fileId/meta", async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const meta = await fileService.getMetadata(fileId);

    if (!meta) {
      reply.code(404).send({ error: "File not found" });
      return;
    }

    reply.send({
      id: meta.id,
      fileName: meta.fileName,
      contentType: meta.contentType,
      size: meta.size,
      fromAgent: meta.fromAgent,
      createdAt: meta.createdAt,
      expiresAt: meta.expiresAt,
    });
  });
}
