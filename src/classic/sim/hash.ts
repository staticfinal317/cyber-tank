/**
 * 经典复刻 · FNV-1a 32 位哈希（确定性回归测试用）
 */
const FNV_PRIME = 16777619;
export const FNV_INIT = 0x811c9dc5 >>> 0;

export function fnvByte(hash: number, byte: number): number {
  const h = hash ^ (byte & 0xff);
  return Math.imul(h, FNV_PRIME) >>> 0;
}

export function fnvInt32(hash: number, value: number): number {
  const v = value >>> 0;
  let h = hash;
  h = fnvByte(h, v & 0xff);
  h = fnvByte(h, (v >>> 8) & 0xff);
  h = fnvByte(h, (v >>> 16) & 0xff);
  h = fnvByte(h, (v >>> 24) & 0xff);
  return h;
}

export function fnvBool(hash: number, value: boolean): number {
  return fnvByte(hash, value ? 1 : 0);
}

export function fnvBytes(hash: number, bytes: Uint8Array): number {
  let h = hash;
  for (let i = 0; i < bytes.length; i += 1) {
    h = fnvByte(h, bytes[i] as number);
  }
  return h;
}
