import React, { useCallback, useMemo, useState } from "react";
import { createDemoSubstationBundle } from "./data/demoSubstationModel";
import { ingestBimFile } from "./parsers/ingestFile";
import { FieldViewport3D } from "./components/FieldViewport3D";
import type { BimElement, BimModelBundle, BimSystemCategory } from "./types/bim";

const CATEGORIES: Array<{ id: "all" | BimSystemCategory; label: string }> = [
  { id: "all", label: "All Systems" },
  { id: "switchgear", label: "Switchgear" },
  { id: "panelboard", label: "Panels" },
  { id: "transformer", label: "Transformers" },
  { id: "conduit", label: "Conduit" },
  { id: "lighting", label: "Lighting" },
  { id: "fire_alarm", label: "Fire Alarm" },
  { id: "disconnect", label: "Disconnects" },
];

const VOLTAGE_FILTERS = ["All", "480", "277", "208", "120", "24V"] as const;

export function App(): React.ReactElement {
  const [bundle, setBundle] = useState<BimModelBundle>(() => createDemoSubstationBundle());
  const [selectedId, setSelectedId] = useState<string | null>(() => createDemoSubstationBundle().elements[0]?.id ?? null);
  const [catFilter, setCatFilter] = useState<"all" | BimSystemCategory>("all");
  const [voltFilter, setVoltFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [xrayConduits, setXrayConduits] = useState(false);
  const [showStreams, setShowStreams] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldStatuses, setFieldStatuses] = useState<Record<string, BimElement["status"]>>({});

  const visibleElements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bundle.elements.filter((el) => {
      if (catFilter !== "all" && el.category !== catFilter) return false;
      if (voltFilter !== "All" && !el.voltage.toLowerCase().includes(voltFilter.toLowerCase())) return false;
      if (!q) return true;
      return `${el.tag} ${el.name} ${el.room} ${el.circuit ?? ""} ${el.raceway ?? ""} ${el.panelFeed ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [bundle.elements, catFilter, voltFilter, searchQuery]);

  const selectedElement = useMemo(() => {
    const found = bundle.elements.find((e) => e.id === selectedId) ?? visibleElements[0] ?? null;
    if (!found) return null;
    return { ...found, status: fieldStatuses[found.id] ?? found.status };
  }, [bundle.elements, fieldStatuses, selectedId, visibleElements]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoadError(null);
    const file = files[0];
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const parsed = await ingestBimFile(file.name, buf);
      setBundle(parsed);
      setSelectedId(parsed.elements[0]?.id ?? null);
      setCatFilter("all");
      setVoltFilter("All");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const cycleStatus = (el: BimElement) => {
    const order: BimElement["status"][] = ["Design", "Rough-In", "Terminated", "Energized"];
    const cur = fieldStatuses[el.id] ?? el.status;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    setFieldStatuses((prev) => ({ ...prev, [el.id]: next }));
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0b1120", color: "#f8fafc" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void handleFiles(e.dataTransfer.files);
      }}
    >
      {/* Top Field Crew Header */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "#0f172a",
          borderBottom: "1px solid #1e293b",
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" }}>
            OmniForge Field BIM &middot; <span style={{ color: "#38bdf8" }}>{bundle.sourceFileName}</span>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {bundle.engineer} &middot; {bundle.sourceFormat} &middot; Raw{" "}
            {(bundle.rawBytes / 1048576).toFixed(2)} MiB &rarr; Q14 Field Packet{" "}
            <strong style={{ color: "#34d399" }}>{(bundle.compactedBytes / 1024).toFixed(1)} KiB (-{bundle.compactionPct}%)</strong>
            {" "}&middot; FNV-64 <code>{bundle.checksumFnv64}</code>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label
            style={{
              padding: "7px 12px",
              borderRadius: 7,
              background: "#0284c7",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Open .RVT / .IFC / .NWD / .CSV
            <input
              type="file"
              accept=".rvt,.rfa,.rte,.ifc,.xml,.csv,.nwd,.nwc"
              style={{ display: "none" }}
              onChange={(e) => void handleFiles(e.target.files)}
            />
          </label>
          <button
            type="button"
            onClick={() => setXrayConduits((x) => !x)}
            style={{
              padding: "7px 12px",
              borderRadius: 7,
              border: "1px solid #334155",
              background: xrayConduits ? "#10b981" : "#1e293b",
              color: xrayConduits ? "#022c22" : "#e2e8f0",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {xrayConduits ? "Conduit X-Ray: ON" : "Conduit X-Ray"}
          </button>
          <button
            type="button"
            onClick={() => setShowStreams((s) => !s)}
            style={{
              padding: "7px 12px",
              borderRadius: 7,
              border: "1px solid #334155",
              background: showStreams ? "#38bdf8" : "#1e293b",
              color: showStreams ? "#082f49" : "#e2e8f0",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            RVT / Container Info ({bundle.rvtMeta.streamCount})
          </button>
        </div>
      </header>

      {loadError && (
        <div style={{ padding: "8px 16px", background: "#7f1d1d", color: "#fecaca", fontSize: 13 }}>
          Import Error: {loadError}
        </div>
      )}

      {/* Main Split Workspace: Left Filter/Schedule | Center 3D Model | Right Electrical Field Cut-Sheet */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "290px 1fr 330px", minHeight: 0 }}>
        {/* Equipment & Raceway Schedule */}
        <aside style={{ borderRight: "1px solid #1e293b", background: "#0f172a", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 12, borderBottom: "1px solid #1e293b", display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="search"
              placeholder="Search tag, circuit, conduit, room..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#020617",
                color: "#f8fafc",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCatFilter(c.id)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: "1px solid #334155",
                    background: catFilter === c.id ? "#38bdf8" : "#1e293b",
                    color: catFilter === c.id ? "#082f49" : "#cbd5e1",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, marginRight: 2 }}>VOLTS:</span>
              {VOLTAGE_FILTERS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVoltFilter(v)}
                  style={{
                    padding: "3px 6px",
                    borderRadius: 4,
                    border: "1px solid #334155",
                    background: voltFilter === v ? "#f59e0b" : "#1e293b",
                    color: voltFilter === v ? "#451a03" : "#cbd5e1",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleElements.map((el) => {
              const active = selectedElement?.id === el.id;
              const st = fieldStatuses[el.id] ?? el.status;
              return (
                <button
                  key={el.id}
                  type="button"
                  onClick={() => setSelectedId(el.id)}
                  style={{
                    textAlign: "left",
                    padding: "9px 10px",
                    borderRadius: 8,
                    border: active ? "1px solid #38bdf8" : "1px solid #1e293b",
                    background: active ? "#172554" : "#0b1324",
                    color: "#f8fafc",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <strong style={{ fontSize: 13, color: "#38bdf8" }}>{el.tag}</strong>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 999, background: "#1e293b", color: "#34d399", fontWeight: 700 }}>
                      {st}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#e2e8f0", marginTop: 2 }}>{el.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                    {el.voltage} &middot; {el.amperage} &middot; {el.room}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Center 3D Field Canvas */}
        <main style={{ position: "relative", minHeight: 0 }}>
          <FieldViewport3D
            elements={visibleElements}
            selectedId={selectedElement?.id ?? null}
            onSelect={(id) => setSelectedId(id)}
            xrayConduits={xrayConduits}
          />
          <div
            style={{
              position: "absolute",
              left: 12,
              bottom: 12,
              padding: "6px 10px",
              borderRadius: 7,
              background: "rgba(15, 23, 42, 0.85)",
              border: "1px solid #334155",
              fontSize: 11,
              color: "#cbd5e1",
              pointerEvents: "none",
            }}
          >
            Tap panel / conduit to inspect &middot; Drag to orbit &middot; Scroll/Pinch to zoom &middot; Showing {visibleElements.length}/{bundle.elements.length} items
          </div>
        </main>

        {/* Right Panel: Field Cut-Sheet + Revit Stream Inspector */}
        <aside style={{ borderLeft: "1px solid #1e293b", background: "#0f172a", overflowY: "auto", padding: 14 }}>
          {showStreams ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 14, color: "#38bdf8" }}>Model Container &amp; Revit OLE2 Metadata</h3>
              {bundle.rvtMeta.previewPngDataUrl && (
                <img
                  src={bundle.rvtMeta.previewPngDataUrl}
                  alt="Embedded RevitPreview4.0 thumbnail"
                  style={{ width: "100%", borderRadius: 8, border: "1px solid #334155" }}
                />
              )}
              <div style={{ fontSize: 12, color: "#cbd5e1", display: "grid", gap: 4 }}>
                <div><strong>Format:</strong> {bundle.rvtMeta.revitFormat ?? bundle.rvtMeta.containerType}</div>
                {bundle.rvtMeta.revitBuild && <div><strong>Revit Build:</strong> {bundle.rvtMeta.revitBuild}</div>}
                {bundle.rvtMeta.projectGuid && <div><strong>Project GUID:</strong> <code>{bundle.rvtMeta.projectGuid}</code></div>}
                {bundle.rvtMeta.lastSavePath && <div><strong>Save Path:</strong> {bundle.rvtMeta.lastSavePath}</div>}
              </div>
              {bundle.rvtMeta.notes.map((n, i) => (
                <div key={i} style={{ fontSize: 12, padding: 8, borderRadius: 6, background: "#1e293b", color: "#e2e8f0" }}>
                  {n}
                </div>
              ))}
              {bundle.rvtMeta.streams.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>
                    Streams ({bundle.rvtMeta.streams.length})
                  </div>
                  <div style={{ maxHeight: 220, overflowY: "auto", fontSize: 11, fontFamily: "ui-monospace, monospace", background: "#020617", padding: 8, borderRadius: 6 }}>
                    {bundle.rvtMeta.streams.slice(0, 40).map((s, idx) => (
                      <div key={idx}>{s.name} ({s.byteLength.toLocaleString()} B)</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : selectedElement ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, textTransform: "uppercase", color: "#38bdf8", fontWeight: 800 }}>
                    {selectedElement.category.replace("_", " ")}
                  </div>
                  <h2 style={{ margin: "2px 0 0", fontSize: 20 }}>{selectedElement.tag}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => cycleStatus(selectedElement)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #10b981",
                    background: "#064e3b",
                    color: "#a7f3d0",
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Status: {selectedElement.status}
                </button>
              </div>

              <div style={{ fontSize: 13, color: "#e2e8f0" }}>{selectedElement.name}</div>

              <div style={{ display: "grid", gap: 8, padding: 10, borderRadius: 8, background: "#020617", border: "1px solid #1e293b", fontSize: 12 }}>
                <div><span style={{ color: "#94a3b8" }}>System:</span> <strong>{selectedElement.system}</strong></div>
                <div><span style={{ color: "#94a3b8" }}>Voltage / Phase:</span> <strong style={{ color: "#fbbf24" }}>{selectedElement.voltage}</strong> {selectedElement.poles ?? ""}</div>
                <div><span style={{ color: "#94a3b8" }}>Rating / Load:</span> <strong>{selectedElement.amperage}</strong></div>
                {selectedElement.panelFeed && <div><span style={{ color: "#94a3b8" }}>Fed From:</span> <strong>{selectedElement.panelFeed}</strong></div>}
                {selectedElement.circuit && <div><span style={{ color: "#94a3b8" }}>Circuit ID:</span> <strong style={{ color: "#38bdf8" }}>{selectedElement.circuit}</strong></div>}
                {selectedElement.breaker && <div><span style={{ color: "#94a3b8" }}>OCPD / Breaker:</span> <strong>{selectedElement.breaker}</strong></div>}
                {selectedElement.raceway && <div><span style={{ color: "#94a3b8" }}>Conduit / Raceway:</span> <strong style={{ color: "#34d399" }}>{selectedElement.raceway}</strong></div>}
                {selectedElement.wireSpec && <div><span style={{ color: "#94a3b8" }}>Conductors:</span> <strong>{selectedElement.wireSpec}</strong></div>}
                <div><span style={{ color: "#94a3b8" }}>Location:</span> <strong>{selectedElement.room} ({selectedElement.level})</strong></div>
                <div><span style={{ color: "#94a3b8" }}>Elevation:</span> <strong>{selectedElement.elevationFt}</strong></div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#94a3b8" }}>Tap any piece of equipment or conduit run in the 3D view.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
