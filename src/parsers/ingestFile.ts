import type { BimModelBundle } from "../types/bim";
import { compactBimBundle } from "../codec/bimFieldPacker";
import { isOle2Cfbf, parseRevitOle2Container } from "./rvtCfbParser";
import { parseIfcStepModel, parseNavisworksXmlOrCsv } from "./ifcAndNavisworksParser";

export async function ingestBimFile(fileName: string, bytes: Uint8Array): Promise<BimModelBundle> {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".rvt") || lower.endsWith(".rfa") || lower.endsWith(".rte") || isOle2Cfbf(bytes)) {
    const { meta, derivedElements } = parseRevitOle2Container(bytes, fileName);
    return compactBimBundle({
      id: `rvt_${Date.now()}`,
      title: `${fileName} — Revit OLE2 Field Inspector`,
      projectNumber: meta.projectGuid?.slice(0, 8).toUpperCase() ?? "RVT-CFBF",
      engineer: meta.username ?? "Revit Author",
      sourceFileName: fileName,
      sourceFormat: "OLE2_CFBF",
      rawBytes: bytes.byteLength,
      rvtMeta: meta,
      elements:
        derivedElements.length > 0
          ? derivedElements
          : [
              {
                id: "rvt_container_node",
                tag: fileName.slice(0, 18),
                name: `Revit OLE2 Container (${meta.streamCount} streams)`,
                category: "switchgear",
                system: meta.revitFormat ?? "Revit OLE2 CFBF",
                voltage: "Inspect Streams",
                amperage: `${meta.streamCount} streams`,
                level: "Container Root",
                room: meta.lastSavePath ?? "Local File",
                elevationFt: "N/A",
                status: "Design",
                position: [0, 1.2, 0],
                size: [2.4, 2.0, 1.2],
              },
            ],
    });
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  if (lower.endsWith(".ifc") || text.includes("ISO-10303-21")) {
    const { meta, elements } = parseIfcStepModel(text, fileName);
    return compactBimBundle({
      id: `ifc_${Date.now()}`,
      title: `${fileName} — IFC Electrical Model`,
      projectNumber: "IFC-STEP",
      engineer: "BIM Coordinator",
      sourceFileName: fileName,
      sourceFormat: "IFC_STEP",
      rawBytes: bytes.byteLength,
      rvtMeta: meta,
      elements,
    });
  }

  const { meta, elements } = parseNavisworksXmlOrCsv(text, fileName);
  return compactBimBundle({
    id: `nwd_${Date.now()}`,
    title: `${fileName} — Navisworks / Schedule Model`,
    projectNumber: "NWD-FIELD",
    engineer: "Electrical Design",
    sourceFileName: fileName,
    sourceFormat: meta.containerType,
    rawBytes: bytes.byteLength,
    rvtMeta: meta,
    elements,
  });
}
