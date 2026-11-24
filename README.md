# OmniForge Field BIM Viewer (Revit `.rvt` / Navisworks / IFC4)

Lightweight, zero-bloat field electrical viewer built for field crews and electrical engineers (**Andy Zurick** workflow) using Q14 quantized BIM packets (`@omniforge/bim-field-viewer`).

## Capabilities

- **Zero-Dependency Revit `.rvt` / `.rfa` / `.rte` OLE2 CFBF Parser** (`src/parsers/rvtCfbParser.ts`):
  - Parses Microsoft Compound File Binary Format sector allocation tables (DIFAT / FAT / MiniFAT / directory entries) right in the browser.
  - Extracts `BasicFileInfo` (Revit Build, Format, Central Model Path, Project GUID, Username), embedded `RevitPreview4.0` PNG thumbnails, `PartAtom` XML, and electrical tokens (`480Y/277V`, panel tags, feeder amperages).
  - *Honest Boundary:* Autodesk `.rvt` proprietary internal `ElemTable` geometry requires Revit Desktop / APS Model Derivative or pairing an IFC4 / Navisworks XML / CSV export for full 3D element meshes; all four formats load seamlessly in this viewer.
- **IFC2x3 / IFC4 STEP + Navisworks XML + Revit Schedule CSV Parsers** (`src/parsers/ifcAndNavisworksParser.ts`):
  - Extracts switchgear, distribution boards, transformers, overhead EMT conduits, lighting fixtures, voltages, breaker ampacities, circuits, and coordinates.
- **Q14 Fixed-Point Offline Field Packet Compaction** (`src/codec/bimFieldPacker.ts`):
  - Quantizes 3D spatial placements to Q14 integers (`OMNBIM1`) with FNV-1a-64 integrity hashes (`48.62 MiB` raw -> `< 10 KiB` Q14 packet for the built-in Substation reference model).
- **Field-Ready UI (`src/App.tsx` + `src/components/FieldViewport3D.tsx`)**:
  - Tap equipment/conduit in 3D, filter by **System** or **Voltage (`480V / 277V / 208V / 120V`)**, search by circuit/panel/room, toggle **Conduit X-Ray Mode**, and track installation check-off status (`Design -> Rough-In -> Terminated -> Energized`).

## Quick Start

```bash
bun install
bun test ./tests
bun run build
```
