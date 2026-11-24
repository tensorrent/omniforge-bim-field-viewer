import type { BimElement, CfbStreamSummary, RvtFileMetadata } from "../types/bim";

const CFBF_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAXREGSECT = 0xfffffffa;

export function isOle2Cfbf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 512) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== CFBF_SIG[i]) return false;
  }
  return true;
}

function decodeUtf16LeNull(bytes: Uint8Array): string {
  let end = bytes.byteLength - (bytes.byteLength % 2);
  for (let i = 0; i + 1 < bytes.byteLength; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) {
      end = i;
      break;
    }
  }
  let out = "";
  for (let i = 0; i + 1 < end; i += 2) {
    out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  }
  return out;
}

function decodeUtf16LePrintable(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.byteLength; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (code === 0) {
      out += "\n";
    } else if ((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13) {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.byteLength; i += chunk) {
      const sub = bytes.subarray(i, Math.min(bytes.byteLength, i + chunk));
      for (let j = 0; j < sub.length; j++) bin += String.fromCharCode(sub[j]);
    }
    return btoa(bin);
  }
  let out = "";
  for (let i = 0; i < bytes.byteLength; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.byteLength ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.byteLength ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < bytes.byteLength ? B64[(n >> 6) & 63] : "=") +
      (i + 2 < bytes.byteLength ? B64[n & 63] : "=");
  }
  return out;
}

function extractEmbeddedPngDataUrl(bytes: Uint8Array): string | undefined {
  // Search for PNG magic 89 50 4E 47 0D 0A 1A 0A and IEND AE 42 60 82
  for (let i = 0; i + 16 < bytes.byteLength; i++) {
    if (
      bytes[i] === 0x89 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x4e &&
      bytes[i + 3] === 0x47 &&
      bytes[i + 4] === 0x0d &&
      bytes[i + 5] === 0x0a &&
      bytes[i + 6] === 0x1a &&
      bytes[i + 7] === 0x0a
    ) {
      for (let j = i + 12; j + 8 <= bytes.byteLength; j++) {
        if (
          bytes[j] === 0x49 &&
          bytes[j + 1] === 0x45 &&
          bytes[j + 2] === 0x4e &&
          bytes[j + 3] === 0x44 &&
          bytes[j + 4] === 0xae &&
          bytes[j + 5] === 0x42 &&
          bytes[j + 6] === 0x60 &&
          bytes[j + 7] === 0x82
        ) {
          const png = bytes.subarray(i, j + 8);
          return `data:image/png;base64,${uint8ToBase64(png)}`;
        }
      }
    }
  }
  return undefined;
}

function extractElectricalTokens(textSources: string[]): string[] {
  const joined = textSources.join("\n");
  const hits = new Set<string>();
  const regex =
    /\b(?:480Y\/277V|480V|277V|208Y\/120V|208V|120V|MDP-\d+|LP-\w+|PP-\w+|EP-\w+|TX-\w+|FACP-\w+|CKT-\d+|EMT\s*\d(?:-\d\/\d)?["']?|\d{2,4}A(?:\s*3P|\s*1P)?|Panelboard|Switchgear|Transformer|Conduit)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(joined)) !== null) {
    hits.add(m[0].trim());
    if (hits.size >= 40) break;
  }
  return Array.from(hits);
}

interface ParsedDirEntry {
  name: string;
  objectType: number;
  startSector: number;
  streamSize: number;
}

/**
 * Pure TypeScript Microsoft OLE2 Compound File Binary Format (CFBF) parser for Autodesk Revit (.rvt/.rfa/.rte).
 * Extracts directory streams, BasicFileInfo UTF-16LE metadata, RevitPreview4.0 PNG thumbnail, and PartAtom XML.
 */
export function parseRevitOle2Container(
  bytes: Uint8Array,
  fileName: string,
): { meta: RvtFileMetadata; derivedElements: BimElement[] } {
  const notes: string[] = [];
  if (!isOle2Cfbf(bytes)) {
    throw new Error(`Not a valid OLE2 CFBF Revit container: ${fileName}`);
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const majorVer = dv.getUint16(26, true);
  const sectorShift = dv.getUint16(30, true);
  const sectorSize = 1 << sectorShift;
  const miniSectorShift = dv.getUint16(32, true);
  const miniSectorSize = 1 << miniSectorShift;
  const fatSectorCount = dv.getUint32(44, true);
  const firstDirSector = dv.getUint32(48, true);
  const miniStreamCutoff = dv.getUint32(56, true);
  const firstMiniFatSector = dv.getUint32(60, true);
  const miniFatSectorCount = dv.getUint32(64, true);
  const firstDifatSector = dv.getUint32(68, true);
  const difatSectorCount = dv.getUint32(72, true);

  const sectorOffset = (sectId: number): number => 512 + sectId * sectorSize;

  // 1. Collect FAT sector indices from header DIFAT[0..108] + extra DIFAT chain
  const fatSectorIds: number[] = [];
  for (let i = 0; i < 109 && fatSectorIds.length < fatSectorCount; i++) {
    const sid = dv.getUint32(76 + i * 4, true);
    if (sid <= MAXREGSECT) fatSectorIds.push(sid);
  }
  let curDifat = firstDifatSector;
  let difatSteps = 0;
  while (curDifat <= MAXREGSECT && difatSteps < difatSectorCount + 4 && fatSectorIds.length < fatSectorCount) {
    const off = sectorOffset(curDifat);
    if (off + sectorSize > bytes.byteLength) break;
    const perSect = sectorSize / 4 - 1;
    for (let i = 0; i < perSect && fatSectorIds.length < fatSectorCount; i++) {
      const sid = dv.getUint32(off + i * 4, true);
      if (sid <= MAXREGSECT) fatSectorIds.push(sid);
    }
    curDifat = dv.getUint32(off + perSect * 4, true);
    difatSteps++;
  }

  // 2. Build flat FAT table
  const entriesPerFat = sectorSize / 4;
  const fat = new Uint32Array(fatSectorIds.length * entriesPerFat);
  for (let i = 0; i < fatSectorIds.length; i++) {
    const off = sectorOffset(fatSectorIds[i]);
    if (off + sectorSize > bytes.byteLength) continue;
    for (let j = 0; j < entriesPerFat; j++) {
      fat[i * entriesPerFat + j] = dv.getUint32(off + j * 4, true);
    }
  }

  const readChain = (start: number, limitBytes?: number): Uint8Array => {
    const chunks: Uint8Array[] = [];
    const seen = new Set<number>();
    let cur = start;
    let total = 0;
    while (cur <= MAXREGSECT && !seen.has(cur) && total < bytes.byteLength) {
      seen.add(cur);
      const off = sectorOffset(cur);
      if (off < 512 || off >= bytes.byteLength) break;
      const take = Math.min(sectorSize, bytes.byteLength - off);
      chunks.push(bytes.subarray(off, off + take));
      total += take;
      if (limitBytes !== undefined && total >= limitBytes) break;
      cur = cur < fat.length ? fat[cur] : ENDOFCHAIN;
    }
    const out = new Uint8Array(limitBytes !== undefined ? Math.min(total, limitBytes) : total);
    let pos = 0;
    for (const c of chunks) {
      const n = Math.min(c.byteLength, out.byteLength - pos);
      if (n <= 0) break;
      out.set(c.subarray(0, n), pos);
      pos += n;
    }
    return out;
  };

  // 3. Read Directory Entries (128 bytes each)
  const dirBytes = readChain(firstDirSector);
  const dirDv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const entries: ParsedDirEntry[] = [];
  for (let off = 0; off + 128 <= dirBytes.byteLength; off += 128) {
    const nameLen = dirDv.getUint16(off + 64, true);
    const objectType = dirDv.getUint8(off + 66);
    if (objectType === 0 || nameLen < 2) continue;
    const rawName = dirBytes.subarray(off, off + Math.min(64, nameLen));
    const name = decodeUtf16LeNull(rawName);
    const startSector = dirDv.getUint32(off + 116, true);
    const lowSize = dirDv.getUint32(off + 120, true);
    const highSize = majorVer >= 4 ? dirDv.getUint32(off + 124, true) : 0;
    const streamSize = highSize * 0x100000000 + lowSize;
    entries.push({ name, objectType, startSector, streamSize });
  }

  // 4. MiniFAT + Root Entry MiniStream for streams < miniStreamCutoff
  const rootEntry = entries.find((e) => e.objectType === 5);
  const miniContainer =
    rootEntry && rootEntry.startSector <= MAXREGSECT ? readChain(rootEntry.startSector, rootEntry.streamSize) : new Uint8Array(0);
  const miniFatRaw =
    firstMiniFatSector <= MAXREGSECT && miniFatSectorCount > 0 ? readChain(firstMiniFatSector) : new Uint8Array(0);
  const miniFat = new Uint32Array(Math.floor(miniFatRaw.byteLength / 4));
  const mfDv = new DataView(miniFatRaw.buffer, miniFatRaw.byteOffset, miniFatRaw.byteLength);
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = mfDv.getUint32(i * 4, true);

  const readEntryStream = (e: ParsedDirEntry): Uint8Array => {
    if (e.streamSize === 0 || e.startSector === FREESECT || e.startSector === ENDOFCHAIN) return new Uint8Array(0);
    if (e.streamSize < miniStreamCutoff && e.objectType === 2 && miniContainer.byteLength > 0) {
      const out = new Uint8Array(e.streamSize);
      let cur = e.startSector;
      let pos = 0;
      const seen = new Set<number>();
      while (cur <= MAXREGSECT && pos < e.streamSize && !seen.has(cur)) {
        seen.add(cur);
        const mOff = cur * miniSectorSize;
        const n = Math.min(miniSectorSize, e.streamSize - pos, miniContainer.byteLength - mOff);
        if (mOff < 0 || n <= 0) break;
        out.set(miniContainer.subarray(mOff, mOff + n), pos);
        pos += n;
        cur = cur < miniFat.length ? miniFat[cur] : ENDOFCHAIN;
      }
      return out;
    }
    return readChain(e.startSector, e.streamSize);
  };

  let revitFormat: string | undefined;
  let revitBuild: string | undefined;
  let username: string | undefined;
  let lastSavePath: string | undefined;
  let projectGuid: string | undefined;
  let locale: string | undefined;
  let previewPngDataUrl: string | undefined;
  let partAtomXml: string | undefined;
  const textBlobs: string[] = [];

  for (const e of entries) {
    if (e.objectType !== 2) continue;
    const lower = e.name.toLowerCase();
    if (lower.includes("basicfileinfo")) {
      const buf = readEntryStream(e);
      const txt = decodeUtf16LePrintable(buf);
      textBlobs.push(txt);
      const getField = (k: string) => {
        const m = txt.match(new RegExp(`${k}\\s*:\\s*([^\\r\\n]+)`, "i"));
        return m ? m[1].trim() : undefined;
      };
      revitFormat = getField("Format") ?? getField("Revit Build");
      revitBuild = getField("Build");
      username = getField("Username");
      lastSavePath = getField("Central Model Path") || getField("Last Save Path");
      locale = getField("Locale when saved");
      const guidM = txt.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (guidM) projectGuid = guidM[0];
    } else if (lower.includes("preview")) {
      const buf = readEntryStream(e);
      const url = extractEmbeddedPngDataUrl(buf);
      if (url) previewPngDataUrl = url;
    } else if (lower.includes("partatom")) {
      const buf = readEntryStream(e);
      const xml = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      if (xml.includes("<")) {
        partAtomXml = xml.slice(0, 4000);
        textBlobs.push(xml);
      }
    } else if (lower.includes("transmission") || lower.includes("project") || lower.includes("global")) {
      const buf = readEntryStream(e).subarray(0, 65536);
      textBlobs.push(decodeUtf16LePrintable(buf));
    }
  }

  const streams: CfbStreamSummary[] = entries.map((e) => ({
    name: e.name,
    byteLength: e.streamSize,
    isDirectory: e.objectType !== 2,
  }));

  const extractedElectricalTokens = extractElectricalTokens(textBlobs);
  notes.push(
    `Parsed OLE2 CFBF v${majorVer} container (${sectorSize} B sectors, ${entries.length} directory entries).`,
    "Note: Autodesk .rvt internal ElemTable/Contents geometry uses Revit's proprietary binary serialization; for full 3D conduit & panel placement in web/field builds without Revit Desktop, pair with an IFC4, Navisworks XML/CSV, or GLB export (all directly supported here).",
  );

  // Build representative inspectable nodes from extracted streams / electrical tokens so field inspection works immediately
  const derivedElements: BimElement[] = extractedElectricalTokens.slice(0, 12).map((tok, idx) => ({
    id: `rvt_tok_${idx}`,
    tag: tok,
    name: `RVT Stream Metadata Token: ${tok}`,
    category: /LP|PP|EP|MDP|Panel/i.test(tok)
      ? "panelboard"
      : /TX/i.test(tok)
        ? "transformer"
        : /EMT|Conduit/i.test(tok)
          ? "conduit"
          : "switchgear",
    system: /480|277/i.test(tok) ? "480Y/277V Distribution" : "Building Electrical Metadata",
    voltage: tok.match(/\d{3}Y?\/?\d*V/i)?.[0] ?? "See Schedule",
    amperage: tok.match(/\d{2,4}A/i)?.[0] ?? "TBD",
    level: "Level 1",
    room: "Extracted from OLE2 CFBF",
    elevationFt: "+4'-0\" AFF",
    status: "Design",
    position: [(idx % 4 - 1.5) * 4.2, 1.8, Math.floor(idx / 4) * 4.5 - 3],
    size: [1.6, 2.2, 0.8],
    properties: {
      SourceStream: "BasicFileInfo / PartAtom",
      RevitFormat: revitFormat ?? "OLE2 CFBF",
    },
  }));

  return {
    meta: {
      containerType: "OLE2_CFBF",
      revitFormat,
      revitBuild,
      username,
      lastSavePath,
      projectGuid,
      locale,
      previewPngDataUrl,
      partAtomXml,
      streamCount: entries.length,
      streams,
      extractedElectricalTokens,
      notes,
    },
    derivedElements,
  };
}
