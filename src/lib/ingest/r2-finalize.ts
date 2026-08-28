import { sha256Hex } from "./digests";
import { MAX_SOURCE_BYTES, SourceParseError, readBoundedBytes } from "./parsers";

export type R2LikeObject = {
  key: string;
  size: number;
  body: ReadableStream<Uint8Array> | null;
};

export type R2LikeBucket = {
  get(key: string): Promise<R2LikeObject | null>;
};

export type FinalizedSource = {
  key: string;
  byteSize: number;
  digest: string;
  bytes: Uint8Array;
};

export async function finalizeR2Object(
  bucket: R2LikeBucket,
  key: string,
  maxBytes = MAX_SOURCE_BYTES,
): Promise<FinalizedSource> {
  if (!key || key.includes("..")) {
    throw new SourceParseError("invalid R2 object key");
  }
  const object = await bucket.get(key);
  if (!object || !object.body) {
    throw new SourceParseError("R2 object is missing");
  }
  if (object.size > maxBytes) {
    throw new SourceParseError(`source exceeds ${maxBytes} bytes`);
  }
  const bytes = await readBoundedBytes(object.body, maxBytes);
  return {
    key: object.key,
    byteSize: bytes.byteLength,
    digest: await sha256Hex(bytes),
    bytes,
  };
}
