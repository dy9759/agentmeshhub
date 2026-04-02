import type { MessageBusService } from "../services/message-bus.service.js";

const REAP_INTERVAL_MS = 3600_000; // Check every hour
const TTL_DAYS = 30; // Keep interactions for 30 days

export function startInteractionReaper(messageBus: MessageBusService): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const count = await messageBus.cleanOldInteractions(TTL_DAYS);
      if (count > 0) {
        console.log(`[interaction-reaper] Cleaned ${count} old interaction(s) (>${TTL_DAYS} days)`);
      }
    } catch (err) {
      console.error("[interaction-reaper] Error:", err);
    }
  }, REAP_INTERVAL_MS);
}
