let lastMs = 0;
let counter = 0;

/**
 * UUIDv7 (RFC 9562): 48-bit millisecond timestamp, then a 12-bit counter that keeps ids
 * created in the same millisecond in order, then random bits. Sorts by creation time.
 */
export function newId(now: number = Date.now()): string {
  let ms = Math.max(now, lastMs);
  if (ms === lastMs) {
    counter += 1;
    if (counter > 0xfff) {
      ms += 1;
      counter = 0;
    }
  } else {
    counter = 0;
  }
  lastMs = ms;

  const rand = new Uint8Array(8);
  crypto.getRandomValues(rand);
  rand[0] = (rand[0]! & 0x3f) | 0x80; // variant 10

  const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");
  const tsHex = hex(ms, 12);
  const tail = Array.from(rand, (b) => hex(b, 2)).join("");
  return (
    `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${hex(counter, 3)}-` +
    `${tail.slice(0, 4)}-${tail.slice(4)}`
  );
}
