// Just enough RFC 3161 to ask a timestamp authority whether it answers: a
// TimeStampReq over a SHA-256 digest, and the PKIStatus out of the reply. The
// real timestamp for a signature is fetched by the signature engine (ADR-067 §4).

const SHA256_ALGORITHM = Buffer.from("300d06096086480165030402010500", "hex");

const derLength = (length: number): Buffer => {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  return Buffer.from([0x82, length >> 8, length & 0xff]);
};

const der = (tag: number, content: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);

export const buildTimeStampRequest = (sha256Digest: Buffer): Buffer => {
  if (sha256Digest.length !== 32) throw new Error("A timestamp request needs a SHA-256 digest.");
  const messageImprint = der(0x30, Buffer.concat([SHA256_ALGORITHM, der(0x04, sha256Digest)]));
  const version = Buffer.from([0x02, 0x01, 0x01]);
  const certificateRequested = Buffer.from([0x01, 0x01, 0xff]);
  return der(0x30, Buffer.concat([version, messageImprint, certificateRequested]));
};

const readLength = (bytes: Buffer, offset: number): { length: number; next: number } | null => {
  const first = bytes[offset];
  if (first === undefined) return null;
  if (first < 0x80) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  if (count === 0 || count > 3 || offset + count >= bytes.length) return null;
  let length = 0;
  for (let index = 1; index <= count; index += 1) length = (length << 8) | bytes[offset + index]!;
  return { length, next: offset + 1 + count };
};

// TimeStampResp ::= SEQUENCE { status PKIStatusInfo ::= SEQUENCE { status INTEGER, … }, … }
// 0 granted, 1 granted with modifications, 2+ refused.
export const readTimeStampResponseStatus = (response: Buffer): number | null => {
  if (response[0] !== 0x30) return null;
  const outer = readLength(response, 1);
  if (!outer || response[outer.next] !== 0x30) return null;
  const statusInfo = readLength(response, outer.next + 1);
  if (!statusInfo || response[statusInfo.next] !== 0x02) return null;
  const integer = readLength(response, statusInfo.next + 1);
  if (!integer || integer.length !== 1) return null;
  return response[integer.next] ?? null;
};
