export type BimSystemCategory =
  | "switchgear"
  | "panelboard"
  | "transformer"
  | "conduit"
  | "lighting"
  | "fire_alarm"
  | "disconnect"
  | "structure";

export interface BimElement {
  id: string;
  tag: string;
  name: string;
  category: BimSystemCategory;
  system: string;
  voltage: string;
  amperage: string;
  poles?: string;
  breaker?: string;
  panelFeed?: string;
  circuit?: string;
  raceway?: string;
  wireSpec?: string;
  level: string;
  room: string;
  elevationFt: string;
  status: "Rough-In" | "Terminated" | "Energized" | "Design";
  position: [number, number, number];
  size: [number, number, number];
  rotationY?: number;
  colorHex?: string;
  properties?: Record<string, string>;
}

export interface CfbStreamSummary {
  name: string;
  byteLength: number;
  isDirectory: boolean;
}

export interface RvtFileMetadata {
  containerType: "OLE2_CFBF" | "NWD_ZIP" | "IFC_STEP" | "XML_TREE" | "CSV_SCHEDULE" | "GLB_BIM" | "DEMO";
  revitFormat?: string;
  revitBuild?: string;
  username?: string;
  lastSavePath?: string;
  projectGuid?: string;
  locale?: string;
  previewPngDataUrl?: string;
  partAtomXml?: string;
  streamCount: number;
  streams: CfbStreamSummary[];
  extractedElectricalTokens: string[];
  notes: string[];
}

export interface BimModelBundle {
  id: string;
  title: string;
  projectNumber: string;
  engineer: string;
  sourceFileName: string;
  sourceFormat: RvtFileMetadata["containerType"];
  rawBytes: number;
  compactedBytes: number;
  compactionPct: number;
  checksumFnv64: string;
  rvtMeta: RvtFileMetadata;
  elements: BimElement[];
}
