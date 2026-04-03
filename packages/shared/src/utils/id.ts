import { nanoid } from "nanoid";

export function generateId(prefix?: string): string {
  const id = nanoid(16);
  return prefix ? `${prefix}-${id}` : id;
}

export function generateAgentId(): string {
  return generateId("agent");
}

export function generateOwnerId(): string {
  return generateId("owner");
}

export function generateTaskId(): string {
  return generateId("task");
}

export function generateInteractionId(): string {
  return generateId("int");
}

export function generateFileId(): string {
  return generateId("file");
}

export function generateSessionId(): string {
  return generateId("ses");
}

export function generateTeamId(): string {
  return generateId("team");
}

export function generateRemoteSessionId(): string {
  return generateId("rsess");
}
