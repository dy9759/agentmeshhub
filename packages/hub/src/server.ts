import { createApp } from "./app.js";
import { execSync } from "node:child_process";

const PORT = parseInt(process.env.PORT || "5555", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DB_URL = process.env.DATABASE_URL || "agentmesh.db";

// Kill any existing process on the port
try {
  const pids = execSync(`lsof -ti:${PORT}`, { encoding: "utf-8" }).trim();
  if (pids) {
    console.log(`Port ${PORT} is occupied (PIDs: ${pids}), killing...`);
    execSync(`kill -9 ${pids.split("\n").join(" ")}`);
    // Brief wait for port release
    execSync("sleep 0.5");
  }
} catch {
  // No process on port — good
}

const { app } = createApp({ dbUrl: DB_URL, port: PORT, host: HOST });

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`AgentMesh Hub running on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
