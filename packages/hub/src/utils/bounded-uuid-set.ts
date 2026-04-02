/**
 * Fixed-capacity ring buffer for UUID deduplication.
 * Inspired by Claude Code's BoundedUUIDSet pattern.
 * O(1) add/has/evict, bounded memory.
 */
export class BoundedUUIDSet {
  private readonly capacity: number;
  private readonly ring: (string | undefined)[];
  private readonly set = new Set<string>();
  private writeIdx = 0;

  constructor(capacity: number = 2000) {
    this.capacity = capacity;
    this.ring = new Array(capacity).fill(undefined);
  }

  add(uuid: string): boolean {
    if (this.set.has(uuid)) return false; // duplicate
    const evicted = this.ring[this.writeIdx];
    if (evicted !== undefined) {
      this.set.delete(evicted);
    }
    this.ring[this.writeIdx] = uuid;
    this.set.add(uuid);
    this.writeIdx = (this.writeIdx + 1) % this.capacity;
    return true; // new entry
  }

  has(uuid: string): boolean {
    return this.set.has(uuid);
  }

  get size(): number {
    return this.set.size;
  }
}
