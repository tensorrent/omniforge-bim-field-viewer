import type { BimElement, BimSystemCategory, RvtFileMetadata } from "../types/bim";

function classifyCategory(text: string): BimSystemCategory {
  const s = text.toLowerCase();
  if (s.includes("switchgear") || s.includes("mdp") || s.includes("switchboard")) return "switchgear";
  if (s.includes("transformer") || s.includes("xfmr") || s.includes("tx-")) return "transformer";
  if (s.includes("conduit") || s.includes("cablecarrier") || s.includes("emt") || s.includes("tray")) return "conduit";
  if (s.includes("light") || s.includes("luminaire") || s.includes("fixture")) return "lighting";
  if (s.includes("fire") || s.includes("facp") || s.includes("alarm")) return "fire_alarm";
  if (s.includes("disconnect") || s.includes("vfd") || s.includes("starter")) return "disconnect";
  if (s.includes("panel") || s.includes("board") || s.includes("lp-") || s.includes("ep-")) return "panelboard";
  return "panelboard";
}

function splitStepArgs(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'") inStr = !inStr;
    if (!inStr) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}

function unquoteStep(s: string | undefined): string {
  if (!s || s === "$") return "";
  const t = s.trim();
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1);
  return t;
}

/**
 * Lightweight IFC2x3 / IFC4 STEP parser focused on MEP Electrical elements, properties & coordinates.
 */
export function parseIfcStepModel(text: string, fileName: string): { meta: RvtFileMetadata; elements: BimElement[] } {
  const entityMap = new Map<number, { type: string; args: string }>();
  const normalized = text.replace(/\r?\n/g, " ");
  const stmtRe = /#(\d+)\s*=\s*(IFC[A-Z0-9_]+)\s*\(([^;]*)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(normalized)) !== null) {
    entityMap.set(Number(m[1]), { type: m[2], args: m[3] });
  }

  const getPoint = (refStr: string | undefined): [number, number, number] => {
    if (!refStr) return [0, 0, 0];
    const idM = refStr.match(/#(\d+)/);
    if (!idM) return [0, 0, 0];
    const ent = entityMap.get(Number(idM[1]));
    if (!ent) return [0, 0, 0];
    if (ent.type === "IFCCARTESIANPOINT") {
      const nums = ent.args.replace(/[()]/g, "").split(",").map((x) => Number(x.trim()));
      const rawX = Number.isFinite(nums[0]) ? nums[0] : 0;
      const rawY = Number.isFinite(nums[1]) ? nums[1] : 0;
      const rawZ = Number.isFinite(nums[2]) ? nums[2] : 0;
      // Normalize mm-scale IFC files cleanly to meters
      const maxAbs = Math.max(Math.abs(rawX), Math.abs(rawY), Math.abs(rawZ));
      const scale = maxAbs > 250 ? 0.001 : 1;
      return [rawX * scale, rawZ * scale, -rawY * scale];
    }
    const args = splitStepArgs(ent.args);
    for (const a of args) {
      if (a.includes("#")) {
        const sub = entityMap.get(Number(a.replace("#", "")));
        if (sub && (sub.type === "IFCAXIS2PLACEMENT3D" || sub.type === "IFCLOCALPLACEMENT" || sub.type === "IFCCARTESIANPOINT")) {
          const p = getPoint(a);
          if (p[0] !== 0 || p[1] !== 0 || p[2] !== 0) return p;
        }
      }
    }
    return [0, 0, 0];
  };

  // Extract property single values so electrical attributes show cleanly
  const propsByText = new Map<string, string>();
  for (const [, ent] of entityMap) {
    if (ent.type === "IFCPROPERTYSINGLEVALUE") {
      const a = splitStepArgs(ent.args);
      const k = unquoteStep(a[0]);
      const vRaw = a[2] ?? "";
      const valM = vRaw.match(/\('([^']*)'\)/) ?? vRaw.match(/\(([^)]+)\)/);
      if (k && valM) propsByText.set(k.toLowerCase(), valM[1]);
    }
  }

  const elements: BimElement[] = [];
  const tokens: string[] = [];
  let idx = 0;

  for (const [id, ent] of entityMap) {
    const isElec =
      ent.type.includes("DISTRIBUTIONBOARD") ||
      ent.type.includes("TRANSFORMER") ||
      ent.type.includes("SWITCHINGDEVICE") ||
      ent.type.includes("CABLECARRIER") ||
      ent.type.includes("LIGHTFIXTURE") ||
      ent.type.includes("OUTLET") ||
      ent.type.includes("ELECTRIC") ||
      ent.type.includes("FLOWTERMINAL") ||
      ent.type.includes("FLOWSEGMENT");
    if (!isElec) continue;

    const a = splitStepArgs(ent.args);
    const name = unquoteStep(a[2]) || unquoteStep(a[1]) || `${ent.type}_${id}`;
    const desc = unquoteStep(a[3]) || unquoteStep(a[4]) || "";
    const tag = unquoteStep(a[7]) || `EL-${id}`;
    const pos = getPoint(a[5]);
    const fallbackX = (idx % 6 - 2.5) * 3.5;
    const fallbackZ = Math.floor(idx / 6) * 3.5 - 4;
    const position: [number, number, number] =
      pos[0] === 0 && pos[1] === 0 && pos[2] === 0 ? [fallbackX, 1.5, fallbackZ] : pos;

    const cat = classifyCategory(`${ent.type} ${name} ${desc} ${tag}`);
    const voltM = `${name} ${desc}`.match(/480Y\/277V|208Y\/120V|\d{3}V/i);
    const ampM = `${name} ${desc}`.match(/\d{2,4}A/i);
    tokens.push(tag);

    elements.push({
      id: `ifc_${id}`,
      tag,
      name,
      category: cat,
      system: ent.type,
      voltage: voltM?.[0] ?? propsByText.get("voltage") ?? "208Y/120V",
      amperage: ampM?.[0] ?? propsByText.get("amperage") ?? "225A",
      raceway: cat === "conduit" ? '1" EMT' : undefined,
      level: "Level 1",
      room: desc || `IFC Space #${id}`,
      elevationFt: `${(position[1] * 3.28084).toFixed(1)} ft AFF`,
      status: "Design",
      position,
      size: cat === "conduit" ? [3.2, 0.25, 0.25] : cat === "lighting" ? [1.2, 0.2, 0.6] : [1.4, 2.0, 0.7],
      properties: { IfcEntity: `#${id} ${ent.type}`, SourceFile: fileName },
    });
    idx++;
  }

  return {
    meta: {
      containerType: "IFC_STEP",
      revitFormat: "IFC STEP Electrical Extract",
      streamCount: entityMap.size,
      streams: [{ name: fileName, byteLength: text.length, isDirectory: false }],
      extractedElectricalTokens: tokens.slice(0, 30),
      notes: [`Parsed ${entityMap.size.toLocaleString()} IFC STEP entities; extracted ${elements.length} MEP/Electrical objects.`],
    },
    elements,
  };
}

/**
 * Lightweight Navisworks XML Selection/Property Tree & Revit Schedule CSV Parser.
 */
export function parseNavisworksXmlOrCsv(text: string, fileName: string): { meta: RvtFileMetadata; elements: BimElement[] } {
  const lower = fileName.toLowerCase();
  const elements: BimElement[] = [];

  if (lower.endsWith(".csv") || (!text.trimStart().startsWith("<") && text.includes(","))) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const headers = (lines[0] ?? "").split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const getCol = (names: string[], fallback = "") => {
        for (const n of names) {
          const idx = headers.findIndex((h) => h.includes(n));
          if (idx >= 0 && cols[idx]) return cols[idx];
        }
        return fallback;
      };
      const tag = getCol(["tag", "panel", "mark", "id"], `ITEM-${i}`);
      const name = getCol(["name", "description", "equipment", "family"], tag);
      const cat = classifyCategory(`${tag} ${name} ${getCol(["category", "system"])}`);
      elements.push({
        id: `csv_${i}`,
        tag,
        name,
        category: cat,
        system: getCol(["system", "distribution"], "Electrical Distribution"),
        voltage: getCol(["volt"], "480Y/277V"),
        amperage: getCol(["amp", "rating", "bus"], "225A"),
        circuit: getCol(["circuit", "ckt"], undefined) || undefined,
        raceway: getCol(["conduit", "raceway", "size"], undefined) || undefined,
        wireSpec: getCol(["wire", "conductor"], undefined) || undefined,
        level: getCol(["level", "floor"], "Level 1"),
        room: getCol(["room", "space", "location"], "Main Elec"),
        elevationFt: getCol(["elev", "height"], "+4'-0\" AFF"),
        status: "Design",
        position: [((i - 1) % 5 - 2) * 3.8, cat === "conduit" ? 3.2 : 1.4, Math.floor((i - 1) / 5) * 4 - 3],
        size: cat === "conduit" ? [3.4, 0.25, 0.25] : [1.4, 2.0, 0.7],
      });
    }
    return {
      meta: {
        containerType: "CSV_SCHEDULE",
        revitFormat: "Revit / Navisworks CSV Schedule",
        streamCount: lines.length,
        streams: [{ name: fileName, byteLength: text.length, isDirectory: false }],
        extractedElectricalTokens: elements.slice(0, 20).map((e) => e.tag),
        notes: [`Parsed ${elements.length} schedule rows cleanly from CSV export.`],
      },
      elements,
    };
  }

  // Navisworks Selection/Property XML Tree (tag-tolerant browser regex scanner so works identically headless & in DOM)
  const objMatches = text.match(/<(?:view|node|object|element|item)\b[^>]*>[\s\S]*?<\/(?:view|node|object|element|item)>/gi) ?? [];
  const scanList = objMatches.length > 0 ? objMatches.slice(0, 120) : [text];
  scanList.forEach((blk, idx) => {
    const nameM = blk.match(/(?:name|Label|Tag)\s*=\s*"([^"]+)"/i);
    if (!nameM) return;
    const rawName = nameM[1];
    const voltM = blk.match(/480Y\/277V|208Y\/120V|\d{3}V/i);
    const ampM = blk.match(/\d{2,4}A/i);
    const cat = classifyCategory(`${rawName} ${blk.slice(0, 300)}`);
    elements.push({
      id: `nwd_${idx}`,
      tag: rawName.slice(0, 24),
      name: rawName,
      category: cat,
      system: "Navisworks Selection Property",
      voltage: voltM?.[0] ?? "480Y/277V",
      amperage: ampM?.[0] ?? "225A",
      level: "Level 1",
      room: "Navisworks Scene",
      elevationFt: "+4'-0\" AFF",
      status: "Design",
      position: [(idx % 5 - 2) * 3.6, 1.5, Math.floor(idx / 5) * 3.6 - 4],
      size: cat === "conduit" ? [3.2, 0.28, 0.28] : [1.5, 2.0, 0.7],
    });
  });

  return {
    meta: {
      containerType: "XML_TREE",
      revitFormat: "Navisworks XML Property Export",
      streamCount: objMatches.length || 1,
      streams: [{ name: fileName, byteLength: text.length, isDirectory: false }],
      extractedElectricalTokens: elements.slice(0, 20).map((e) => e.tag),
      notes: [`Extracted ${elements.length} model elements from Navisworks XML.`],
    },
    elements,
  };
}
