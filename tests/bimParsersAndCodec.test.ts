import { describe, expect, test } from "bun:test";
import { parseRevitOle2Container } from "../src/parsers/rvtCfbParser";
import { parseIfcStepModel, parseNavisworksXmlOrCsv } from "../src/parsers/ifcAndNavisworksParser";
import { createDemoSubstationBundle } from "../src/data/demoSubstationModel";
import { compactBimBundle, unpackOmnbimPacket } from "../src/codec/bimFieldPacker";

/**
 * Builds a minimal compliant OLE2 CFBF v3 (512 B sector) synthetic Revit `.rvt` file with:
 * - Sector 0: FAT
 * - Sector 1: Directory (Root Entry + BasicFileInfo + RevitPreview4.0)
 * - Sector 2: BasicFileInfo UTF-16LE payload (Format, Build, Username, Project GUID, MDP-1/LP-1A tokens)
 * - Sector 3: RevitPreview4.0 embedded PNG header+IEND payload
 */
function buildSyntheticRvtCfbf(): Uint8Array {
  const sectorSize = 512;
  const totalBytes = 512 * 5; // Header + 4 sectors
  const buf = new Uint8Array(totalBytes);
  const dv = new DataView(buf.buffer);

  // Header
  buf.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  dv.setUint16(24, 0x003e, true); // minor ver
  dv.setUint16(26, 0x0003, true); // v3
  dv.setUint16(28, 0xfffe, true); // little-endian
  dv.setUint16(30, 9, true); // 512 B sectors
  dv.setUint16(32, 6, true); // 64 B mini sectors
  dv.setUint32(44, 1, true); // 1 FAT sector
  dv.setUint32(48, 1, true); // firstDirSector = 1
  dv.setUint32(56, 0x00001000, true); // miniStreamCutoff = 4096 -> force regular sectors if >= 4096 or adjust cutoff!
  dv.setUint32(56, 64, true); // use regular sectors >= 64 B cleanly
  dv.setUint32(60, 0xfffffffe, true);
  dv.setUint32(68, 0xfffffffe, true);
  for (let i = 0; i < 109; i++) dv.setUint32(76 + i * 4, i === 0 ? 0 : 0xffffffff, true);

  // Sector 0: FAT
  const fatOff = 512;
  dv.setUint32(fatOff + 0 * 4, 0xfffffffd, true); // FATSECT
  dv.setUint32(fatOff + 1 * 4, 0xfffffffe, true); // Dir end
  dv.setUint32(fatOff + 2 * 4, 0xfffffffe, true); // BasicFileInfo end
  dv.setUint32(fatOff + 3 * 4, 0xfffffffe, true); // Preview end

  const writeDirEntry = (idx: number, name: string, type: number, startSect: number, size: number) => {
    const off = 512 * 2 + idx * 128;
    for (let i = 0; i < name.length; i++) {
      dv.setUint16(off + i * 2, name.charCodeAt(i), true);
    }
    dv.setUint16(off + 64, (name.length + 1) * 2, true);
    buf[off + 66] = type;
    dv.setUint32(off + 116, startSect, true);
    dv.setUint32(off + 120, size, true);
  };

  const bfiText =
    "Format: 2025\r\nBuild: 20250410_1515(x64)\r\nUsername: azurick_pe\r\nCentral Model Path: \\\\proj\\AZ_Substation_104.rvt\r\nProject GUID: 7f4a22c0-891b-4c6e-9d11-2a3e8b9104f2\r\nEquipment: MDP-1 480Y/277V 1200A LP-1A\r\n";
  const bfiBytes = new Uint8Array(bfiText.length * 2);
  for (let i = 0; i < bfiText.length; i++) {
    bfiBytes[i * 2] = bfiText.charCodeAt(i) & 0xff;
    bfiBytes[i * 2 + 1] = bfiText.charCodeAt(i) >> 8;
  }

  const fakePng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
    0x1f, 0x15, 0xc4, 0x89,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const previewBuf = new Uint8Array(128);
  previewBuf.set(fakePng, 8);

  writeDirEntry(0, "Root Entry", 5, 0xfffffffe, 0);
  writeDirEntry(1, "BasicFileInfo", 2, 2, bfiBytes.byteLength);
  writeDirEntry(2, "RevitPreview4.0", 2, 3, previewBuf.byteLength);

  buf.set(bfiBytes, 512 * 3);
  buf.set(previewBuf, 512 * 4);
  return buf;
}

describe("OmniForge Field BIM — Revit (.rvt), IFC4, Navisworks & Q14 Packet Codec", () => {
  test("extracts BasicFileInfo, embedded PNG thumbnail, and electrical tokens from OLE2 CFBF .rvt binary", () => {
    const rvt = buildSyntheticRvtCfbf();
    const res = parseRevitOle2Container(rvt, "AZ_Substation_104.rvt");
    expect(res.meta.containerType).toBe("OLE2_CFBF");
    expect(res.meta.revitFormat).toBe("2025");
    expect(res.meta.username).toBe("azurick_pe");
    expect(res.meta.projectGuid).toBe("7f4a22c0-891b-4c6e-9d11-2a3e8b9104f2");
    expect(res.meta.previewPngDataUrl?.startsWith("data:image/png;base64,")).toBe(true);
    expect(res.meta.extractedElectricalTokens).toContain("MDP-1");
    expect(res.meta.extractedElectricalTokens).toContain("480Y/277V");
    expect(res.derivedElements.length).toBeGreaterThanOrEqual(3);
  });

  test("extracts electrical panels, transformers, and conduits from IFC4 STEP text", () => {
    const sampleIfc = `
      ISO-10303-21;
      DATA;
      #10=IFCCARTESIANPOINT((4500.,-2500.,1200.));
      #11=IFCLOCALPLACEMENT($,#10);
      #12=IFCELECTRICDISTRIBUTIONBOARD('g1',$,'LP-2B Lighting Panel 480Y/277V 225A','Corridor 202',$,#11,$,'LP-2B');
      #13=IFCCABLECARRIERSEGMENT('g2',$,'2" EMT Feeder','Rack A',$,#11,$,'HR-202');
      ENDSEC;
    `;
    const res = parseIfcStepModel(sampleIfc, "electrical.ifc");
    expect(res.elements.length).toBe(2);
    expect(res.elements[0].tag).toBe("LP-2B");
    expect(res.elements[0].voltage).toBe("480Y/277V");
    expect(res.elements[0].amperage).toBe("225A");
    expect(res.elements[1].category).toBe("conduit");
  });

  test("parses Navisworks / Revit electrical CSV schedules cleanly", () => {
    const csv = `Tag,Name,System,Voltage,Amps,Circuit,Conduit,Room
LP-1A,Office Panelboard,208Y/120V Power,208Y/120V,225A,TX-1:MAIN,2-1/2" EMT,Room 104`;
    const res = parseNavisworksXmlOrCsv(csv, "panel_schedule.csv");
    expect(res.elements.length).toBe(1);
    expect(res.elements[0].tag).toBe("LP-1A");
    expect(res.elements[0].raceway).toBe('2-1/2" EMT');
  });

  test("compacts reference Electrical Substation BIM bundle into Q14 field packet", () => {
    const demo = createDemoSubstationBundle();
    expect(demo.elements.length).toBe(17);
    expect(demo.compactedBytes).toBeLessThan(demo.rawBytes);
    expect(demo.compactionPct).toBeGreaterThan(95);

    const rebuilt = compactBimBundle({
      id: demo.id,
      title: demo.title,
      projectNumber: demo.projectNumber,
      engineer: demo.engineer,
      sourceFileName: demo.sourceFileName,
      sourceFormat: "DEMO",
      rawBytes: demo.rawBytes,
      rvtMeta: demo.rvtMeta,
      elements: demo.elements,
    });
    expect(rebuilt.checksumFnv64).toBe(demo.checksumFnv64);
    // Spot check unpack signature function compiles & is exported cleanly
    expect(typeof unpackOmnbimPacket).toBe("function");
  });
});
