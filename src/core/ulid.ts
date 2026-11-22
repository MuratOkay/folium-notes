/** ULID generation (26 chars, Crockford base32: 10 time + 16 randomness). */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface UlidOptions {
  /** Epoch milliseconds; defaults to Date.now(). */
  now?: number;
  /** Injectable randomness for deterministic tests (10 bytes). */
  random?: (length: number) => Uint8Array;
}

function encodeTime(time: number): string {
  let t = Math.max(0, Math.floor(time));
  const out = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    out[i] = CROCKFORD[t % 32];
    t = Math.floor(t / 32);
  }
  return out.join('');
}

function encodeBytes(bytes: Uint8Array): string {
  // 80 bits -> 16 base32 chars. Work on a bit buffer to avoid precision loss.
  let buffer = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    buffer = buffer * 256 + byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      const shift = Math.pow(2, bits);
      const digit = Math.floor(buffer / shift) % 32;
      out += CROCKFORD[digit];
    }
    buffer %= Math.pow(2, bits);
  }
  return out;
}

function defaultRandom(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
    return bytes;
  }
  // ULIDs only need uniqueness, not cryptographic strength. Node >= 20 always
  // provides webcrypto, so this branch exists only for exotic hosts.
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** Create a ULID. Monotonicity is not required by the format; uniqueness is. */
export function createUlid(options: UlidOptions = {}): string {
  const time = options.now ?? Date.now();
  const random = (options.random ?? defaultRandom)(10);
  return encodeTime(time) + encodeBytes(random).slice(0, 16);
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

/** Extract the timestamp encoded in a ULID (returns undefined for invalid input). */
export function ulidTime(value: string): Date | undefined {
  if (!isUlid(value)) return undefined;
  let time = 0;
  for (const char of value.slice(0, 10)) {
    const digit = CROCKFORD.indexOf(char);
    if (digit < 0) return undefined;
    time = time * 32 + digit;
  }
  return new Date(time);
}

/** Predicate used by file name generation to keep ids stable and readable. */
export function ulidTimestampPart(value: string): string {
  return isUlid(value) ? value.slice(0, 10) : '';
}
