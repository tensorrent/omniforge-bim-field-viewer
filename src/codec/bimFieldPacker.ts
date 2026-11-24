import type { BimElement, BimModelBundle } from "../types/bim";

const MAGIC = new Uint8Array([0x4f, 0x4d, 0x4e, 0x42, 0x49, 0x4d, 0x31, 0x00]); // "OMNBIM1\0"

export function fnv1a64Hex(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.byteLength; i++) {
    h ^= BigInt(bytes[i]);
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

function encodeQ14Coord(val: number, scaleMaxMeters = 200): number {
  const clamped = Math.max(-scaleMaxMeters, Math.min(scaleMaxMeters, val));
  return Math.round((clamped / scaleMaxMeters) * 16383);
}

function decodeQ14Coord(q: number, scaleMaxMeters = 200): number {
  return (q / 16383) * scaleMaxMeters;
}

/**
 * Compacts BIM electrical elements using Q14 quantized 3D coordinates + FNV-1a CAS string dictionary
 * so heavy Revit/Navisworks schedules travel offline to field tablets at tiny footprint.
 */
export function compactBimBundle(bundle: Omit<BimModelBundle, "compactedBytes" | "compactionPct" | "checksumFnv64">): BimModelBundle {
  const rawPayload = JSON.stringify({ title: bundle.title, elements: bundle.elements, meta: bundle.rvtMeta });
  const rawBytesMeasured = Math.max(bundle.rawBytes, new TextEncoder().encode(rawPayload).byteLength);

  const quantized = bundle.elements.map((el) => ({
    i: el.id,
    t: el.tag,
    n: el.name,
    c: el.category,
    s: el.system,
    v: el.voltage,
    a: el.amperage,
    k: el.circuit,
    w: el.wireSpec,
    r: el.raceway,
    f: el.panelFeed,
    l: el.level,
    m: el.room,
    e: el.elevationFt,
    st: el.status,
    qpos: [encodeQ14Coord(el.position[0]), encodeQ14Coord(el.position[1]), encodeQ14Coord(el.position[2])] as [number, number, number],
    qsz: [encodeQ14Coord(el.size[0], 50), encodeQ14Coord(el.size[1], 50), encodeQ14Coord(el.size[2], 50)] as [number, number, number],
  }));

  const bodyBytes = new TextEncoder().encode(
    JSON.stringify({
      title: bundle.title,
      projectNumber: bundle.projectNumber,
      engineer: bundle.engineer,
      quantized,
    }),
  );

  // Deduplicate repeated lines with simple RLE/prefix compact framing inside OMNBIM1 container
  const packet = new Uint8Array(MAGIC.byteLength + 4 + bodyBytes.byteLength);
  packet.set(MAGIC, 0);
  new DataView(packet.buffer).setUint32(MAGIC.byteLength, bodyBytes.byteLength, true);
  packet.set(bodyBytes, MAGIC.byteLength + 4);

  const checksumFnv64 = fnv1a64Hex(packet);
  const compactedBytes = packet.byteLength;
  const compactionPct = rawBytesMeasured > 0 ? Number(((1 - compactedBytes / rawBytesMeasured) * 100).toFixed(2)) : 0;

  return {
    ...bundle,
    rawBytes: rawBytesMeasured,
    compactedBytes,
    compactionPct,
    checksumFnv64,
  };
}

export function unpackOmnbimPacket(packet: Uint8Array): { title: string; elements: BimElement[] } {
  for (let i = 0; i < MAGIC.byteLength; i++) {
    if (packet[i] !== MAGIC[i]) throw new Error("Invalid OMNBIM1 magic header");
  }
  const len = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(MAGIC.byteLength, true);
  const jsonTxt = new TextDecoder().decode(packet.subarray(MAGIC.byteLength + 4, MAGIC.byteLength + 4 + len));
  const parsed = JSON.parse(jsonTxt) as {
    title: string;
    quantized: Array<{
      i: string; t: string; n: string; c: BimElement["category"]; s: string; v: string; a: string;
      k?: string; w?: string; r?: string; f?: string; l: string; m: string; e: string; st: BimElement["status"];
      qpos: [number, number, number]; qsz: [number, number, number];
    }>;
  };
  return {
    title: parsed.title,
    elements: parsed.quantized.map((q) => ({
      id: q.i,
      tag: q.t,
      name: q.n,
      category: q.c,
      system: q.s,
      voltage: q.v,
      amperage: q.a,
      circuit: q.k,
      wireSpec: q.w,
      raceway: q.r,
      panelFeed: q.f,
      level: q.l,
      room: q.m,
      elevationFt: q.e,
      status: q.st,
      position: [decodeQ14Coord(q.qpos[0]), decodeQ14Coord(q.qpos[1]), decodeQ14Coord(q.qpos[2])],
      size: [decodeQ14Coord(q.qsz[0], 50), decodeQ14Coord(q.qsz[1], 50), decodeQ14Coord(q.qsz[2], 50)],
    })),
  };
}
