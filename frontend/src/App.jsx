import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Eye,
  Layers,
  Loader2,
  PackageCheck,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "";

const KIND = {
  front: { label: "Front Facing", color: "#34d399", chip: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  back: { label: "Back Row Depth", color: "#38bdf8", chip: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  edge: { label: "Edge Reflection", color: "#fbbf24", chip: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  empty: { label: "Empty Gap", color: "#f87171", chip: "bg-red-500/15 text-red-300 ring-red-500/30" },
};

function classify(p, { edgeFilter, separate, minArea, edgeRoi }) {
  if (p.classification === "empty_gap") return "empty";
  if (edgeFilter && p.x - p.width / 2 < edgeRoi) return "edge";
  if (separate) return p.width * p.height >= minArea ? "front" : "back";
  return "front";
}

function KpiCard({ icon: Icon, label, value, tone = "slate", badge, hint }) {
  const tones = {
    slate: "border-slate-800 bg-slate-900/60",
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    sky: "border-sky-500/20 bg-sky-500/5",
    amber: "border-amber-500/20 bg-amber-500/5",
    red: "border-red-500/50 bg-red-500/10 shadow-[0_0_30px_-10px_rgba(248,113,113,0.6)]",
  };
  const text = { slate: "text-slate-100", emerald: "text-emerald-300", sky: "text-sky-300", amber: "text-amber-300", red: "text-red-300" };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-400">
        <span>{label}</span>
        <Icon className={`h-4 w-4 ${text[tone]}`} />
      </div>
      <div className={`mt-2 text-4xl font-semibold tabular-nums ${text[tone]}`}>{value ?? "—"}</div>
      {badge && (
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-200 ring-1 ring-red-500/40">
          <AlertTriangle className="h-3 w-3" /> {badge}
        </span>
      )}
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-indigo-500" : "bg-slate-700"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
      <span>
        <span className="block text-sm font-medium text-slate-200">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

function DetectionCanvas({ src, detections, edgeFilter, edgeRoi }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);

  const draw = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !img.naturalWidth) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const lw = Math.max(2, img.naturalWidth / 400);

    if (edgeFilter) {
      ctx.fillStyle = "rgba(251,191,36,0.12)";
      ctx.fillRect(0, 0, edgeRoi, canvas.height);
      ctx.strokeStyle = "rgba(251,191,36,0.7)";
      ctx.setLineDash([lw * 3, lw * 3]);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(edgeRoi, 0);
      ctx.lineTo(edgeRoi, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    detections.forEach((d) => {
      const { color } = KIND[d.kind];
      const x = d.x - d.width / 2;
      const y = d.y - d.height / 2;
      ctx.lineWidth = lw;
      ctx.strokeStyle = color;
      ctx.globalAlpha = d.kind === "edge" ? 0.55 : 1;
      if (d.kind === "edge") ctx.setLineDash([lw * 2, lw * 2]);
      ctx.strokeRect(x, y, d.width, d.height);
      ctx.setLineDash([]);
      ctx.fillStyle = color + "26";
      ctx.fillRect(x, y, d.width, d.height);
      ctx.globalAlpha = 1;
    });
  }, [detections, edgeFilter, edgeRoi]);

  useEffect(draw, [draw, src]);

  return (
    <div className="relative">
      <img ref={imgRef} src={src} alt="Shelf" onLoad={draw} className="block w-full rounded-xl" />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}

export default function App() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState("overlay");

  const [edgeFilter, setEdgeFilter] = useState(true);
  const [separate, setSeparate] = useState(true);
  const [minArea, setMinArea] = useState(0);

  const inputRef = useRef(null);
  const edgeRoi = result?.settings?.edge_roi_px ?? 60;

  const analyze = async (f) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch(`${API_URL}/api/analyze-shelf`, { method: "POST", body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      setMinArea(data.settings?.suggested_min_area ?? 0);
      setView(data.output_image ? "overlay" : "overlay");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFile = (f) => {
    if (!f || !f.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    analyze(f);
  };

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
  };

  const detections = useMemo(
    () =>
      (result?.predictions ?? []).map((p, i) => ({
        ...p,
        id: i,
        kind: classify(p, { edgeFilter, separate, minArea, edgeRoi }),
      })),
    [result, edgeFilter, separate, minArea, edgeRoi]
  );

  const count = (k) => detections.filter((d) => d.kind === k).length;
  const emptyGaps = result ? (count("empty") || result.raw_counts?.empty_space_count || 0) : null;
  const areas = (result?.predictions ?? []).map((p) => p.width * p.height);
  const maxArea = Math.max(1000, ...areas);
  const hasGap = emptyGaps >= 1;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-4">
          <div className="rounded-xl bg-indigo-500/15 p-2 ring-1 ring-indigo-500/30">
            <ScanSearch className="h-6 w-6 text-indigo-300" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Roboflow ShelfGuard AI</h1>
            <p className="text-sm text-slate-400">Real-Time Planogram &amp; Stock Inspector</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {/* Uploader + controls */}
        <section className="grid gap-6 lg:grid-cols-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition lg:col-span-3 ${
              dragging ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 bg-slate-900/40 hover:border-slate-500"
            }`}
          >
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e.target.files[0])} />
            <UploadCloud className="h-10 w-10 text-indigo-300" />
            <p className="mt-3 font-medium text-slate-100">{file ? file.name : "Drag & drop a shelf photo, or click to browse"}</p>
            <p className="mt-1 text-xs text-slate-500">JPG / PNG · analyzed through your Roboflow Workflow</p>
          </div>

          <div className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Post-Processing Controls</h2>
            <Toggle
              checked={edgeFilter}
              onChange={setEdgeFilter}
              label="Filter Door/Edge Reflections (ROI)"
              description={`Excludes boxes whose left edge is within ${edgeRoi}px of the frame edge.`}
            />
            <div className="space-y-3">
              <Toggle
                checked={separate}
                onChange={setSeparate}
                label="Separate Front-Row Facings vs. Back-Row Depth Stock"
                description="Boxes below the minimum area are counted as back-row depth."
              />
              <div className={separate ? "" : "pointer-events-none opacity-40"}>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Min Box Area</span>
                  <span className="tabular-nums text-slate-200">{Math.round(minArea).toLocaleString()} px²</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.round(maxArea)}
                  value={minArea}
                  onChange={(e) => setMinArea(Number(e.target.value))}
                  className="mt-1 w-full accent-indigo-500"
                />
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {(previewUrl || loading) && (
          <section className="grid gap-6 lg:grid-cols-5">
            {/* Visual inspector */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 lg:col-span-3">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <Eye className="h-4 w-4 text-indigo-300" /> Visual Inspector
                </h2>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg bg-slate-800 p-0.5 text-xs">
                    {[["overlay", "Interactive Overlay"], ["roboflow", "Roboflow Output"]].map(([k, l]) => (
                      <button
                        key={k}
                        disabled={k === "roboflow" && !result?.output_image}
                        onClick={() => setView(k)}
                        className={`rounded-md px-3 py-1 transition disabled:opacity-30 ${view === k ? "bg-indigo-500 text-white" : "text-slate-300"}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <button onClick={reset} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800" title="Clear">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="relative">
                {view === "roboflow" && result?.output_image ? (
                  <img src={`data:image/jpeg;base64,${result.output_image}`} alt="Roboflow output" className="w-full rounded-xl" />
                ) : (
                  <DetectionCanvas src={previewUrl} detections={detections} edgeFilter={edgeFilter} edgeRoi={edgeRoi} />
                )}
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl bg-slate-950/70 text-slate-200">
                    <Loader2 className="h-5 w-5 animate-spin" /> Analyzing shelf…
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {Object.entries(KIND).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1.5 text-slate-400">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: v.color }} /> {v.label}
                  </span>
                ))}
              </div>
            </div>

            {/* KPIs */}
            <div className="grid content-start gap-4 sm:grid-cols-2 lg:col-span-2">
              <KpiCard icon={PackageCheck} tone="emerald" label="Front-Row Facings" value={result && count("front")} />
              <KpiCard icon={Layers} tone="sky" label="Back-Row Depth Stock" value={result && count("back")} />
              <KpiCard
                icon={hasGap ? ShieldAlert : ShieldCheck}
                tone={hasGap ? "red" : "slate"}
                label="Empty Shelf Gaps"
                value={emptyGaps}
                badge={hasGap ? "Restock Alert: Shelf Gap Detected" : null}
              />
              <KpiCard
                icon={Boxes}
                tone="amber"
                label="Filtered Edge / Reflection Noise"
                value={result && count("edge")}
                hint={edgeFilter ? "Excluded from product counts" : "Filter is off"}
              />
            </div>
          </section>
        )}

        {/* Detection table */}
        {result && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-200">Detection Inspector</h2>
              <span className="text-xs text-slate-500">
                {detections.length} boxes · raw product count {result.raw_counts?.product_count}
              </span>
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-900 text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-2">#</th>
                    <th className="px-5 py-2">Class</th>
                    <th className="px-5 py-2">Confidence</th>
                    <th className="px-5 py-2">Box (W × H)</th>
                    <th className="px-5 py-2">Classification</th>
                    <th className="px-5 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {detections.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-800/40">
                      <td className="px-5 py-2 text-slate-500">{d.id + 1}</td>
                      <td className="px-5 py-2 text-slate-200">{d.class}</td>
                      <td className="px-5 py-2 tabular-nums">{(d.confidence * 100).toFixed(1)}%</td>
                      <td className="px-5 py-2 tabular-nums">{Math.round(d.width)} × {Math.round(d.height)}</td>
                      <td className="px-5 py-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${KIND[d.kind].chip}`}>{KIND[d.kind].label}</span>
                      </td>
                      <td className="px-5 py-2 text-xs">
                        {d.kind === "edge" ? (
                          <span className="text-amber-300">Filtered</span>
                        ) : d.kind === "empty" ? (
                          <span className="text-red-300">Restock</span>
                        ) : (
                          <span className="text-emerald-300">Counted</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {detections.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No detections returned.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
