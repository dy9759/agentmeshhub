import type { RegistryService } from "../services/registry.service.js";

const REAP_INTERVAL_MS = 60_000; // Check every 60s
const STALE_THRESHOLD_SECONDS = 300; // 5 minutes without heartbeat = offline

export function startStaleAgentReaper(registry: RegistryService): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const count = await registry.markStaleOffline(STALE_THRESHOLD_SECONDS);
      if (count > 0) {
        console.log(`[reaper] Marked ${count} stale agent(s) as offline`);
      }
    } catch (err) {
      console.error("[reaper] Error:", err);
    }
  }, REAP_INTERVAL_MS);
}
