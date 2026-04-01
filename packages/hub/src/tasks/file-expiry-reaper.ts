import type { FileService } from "../services/file.service.js";

const REAP_INTERVAL_MS = 60_000; // Check every 60s

export function startFileExpiryReaper(fileService: FileService): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const count = await fileService.deleteExpired();
      if (count > 0) {
        console.log(`[file-reaper] Cleaned ${count} expired file(s)`);
      }
    } catch (err) {
      console.error("[file-reaper] Error:", err);
    }
  }, REAP_INTERVAL_MS);
}
