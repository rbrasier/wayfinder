// An approver's remembered handwritten-style signature (ADR-067 §2). A *simple*
// electronic signature: it binds nothing by itself, so it is always printed
// above the attestation block, never instead of it, and never described to users
// as a digital or qualified signature.

export interface DrawnSignature {
  readonly userId: string;
  readonly storagePath: string;
  readonly updatedAt: Date;
}

export const DRAWN_SIGNATURE_MAX_BYTES = 256 * 1024;
const MIN_WIDTH = 100;
const MIN_HEIGHT = 40;
const MAX_WIDTH = 2000;
const MAX_HEIGHT = 1000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngDimensions {
  width: number;
  height: number;
}

export const readPngDimensions = (bytes: Uint8Array): PngDimensions | null => {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

export const drawnSignatureProblem = (bytes: Uint8Array): string | null => {
  const dimensions = readPngDimensions(bytes);
  if (!dimensions) return "A drawn signature must be a PNG image.";
  if (bytes.length > DRAWN_SIGNATURE_MAX_BYTES) return "A drawn signature must be smaller than 256 KB.";

  const tooSmall = dimensions.width < MIN_WIDTH || dimensions.height < MIN_HEIGHT;
  const tooLarge = dimensions.width > MAX_WIDTH || dimensions.height > MAX_HEIGHT;
  if (tooSmall || tooLarge) {
    return `A drawn signature must be between ${MIN_WIDTH}×${MIN_HEIGHT} and ${MAX_WIDTH}×${MAX_HEIGHT} pixels.`;
  }
  return null;
};

// Where a user's drawing is kept. Timestamped so a redraw never overwrites the
// object an already-decided approval's frozen record points at.
export const drawnSignatureStoragePath = (userId: string, at: Date): string =>
  `signatures/drawn/${userId}/${at.getTime()}.png`;
