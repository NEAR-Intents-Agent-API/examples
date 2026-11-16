/**
 * DER ECDSA signature → the raw `r || s` a JWS carries.
 *
 * A cloud KMS or HSM returns an ECDSA signature as ASN.1 DER (`SEQUENCE { INTEGER r, INTEGER s }`).
 * A `WorkloadSigner` returns the 64 raw bytes of RFC 7518 (3.4) instead, each half left-padded to
 * 32 bytes, so a KMS-backed signer converts with this before it returns.
 */
export function derToJoseSignature(der: Uint8Array): Uint8Array {
  // A P-256 signature is short, so every length below fits in one byte.
  if (der[0] !== 0x30) throw new Error("not a DER ECDSA signature");
  const raw = new Uint8Array(64);
  let offset = 2;
  for (const half of [0, 32]) {
    if (der[offset] !== 0x02) throw new Error("not a DER ECDSA signature");
    const length = der[offset + 1] ?? 0;
    let value = der.subarray(offset + 2, offset + 2 + length);
    offset += 2 + length;
    // DER prefixes 0x00 to a value whose high bit is set and drops leading zero bytes.
    while (value.length > 32 && value[0] === 0) value = value.subarray(1);
    if (value.length > 32) throw new Error("not a P-256 signature");
    raw.set(value, half + 32 - value.length);
  }
  return raw;
}
