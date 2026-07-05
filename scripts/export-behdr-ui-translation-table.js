#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

function usage() {
  console.error(
    "usage: node scripts/export-behdr-ui-translation-table.js <FS2_FILE.DAT> <SLPS_019.03> <out.tsv> <maskDir> --ids 827,828,1199 [--invert] [--font-size N] [--line-height N] [--pad N] [--threshold N] [--bold N] [--ink-index N] [--bg-index N] [--source-ink-indexes N[,N...]]"
  );
  process.exit(2);
}

const [datPath, exePath, outTsv, maskDir, ...args] = process.argv.slice(2);
if (!datPath || !exePath || !outTsv || !maskDir) usage();

let idsArg = null;
let invert = false;
let fontSize = 24;
let lineHeight = 24;
let pad = 1;
let threshold = 64;
let bold = 0;
let inkIndex = 232;
let bgIndex = 3;
let sourceInkIndexes = "224-232";
let fs2Lba = 223;
let fs2Sectors = 119472;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--ids") idsArg = args[++i];
  else if (arg === "--invert") invert = true;
  else if (arg === "--font-size") fontSize = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--line-height") lineHeight = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--pad") pad = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--threshold") threshold = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--bold") bold = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--ink-index") inkIndex = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--bg-index") bgIndex = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--source-ink-indexes") sourceInkIndexes = args[++i] || "";
  else if (arg === "--lba") fs2Lba = Number.parseInt(args[++i] || "", 0);
  else if (arg === "--sectors") fs2Sectors = Number.parseInt(args[++i] || "", 0);
  else usage();
}
if (!idsArg) usage();

function parseIds(text) {
  const ids = [];
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      for (let id = Math.min(a, b); id <= Math.max(a, b); id += 1) ids.push(id);
    } else {
      ids.push(Number(trimmed));
    }
  }
  return [...new Set(ids.filter((id) => Number.isInteger(id)))].sort((a, b) => a - b);
}

function escapeTsv(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r/g, "").replace(/\n/g, "\\n");
}

function unescapeTsv(value) {
  const marker = "\ue000";
  return String(value ?? "").replace(/\\\\/g, marker).replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(new RegExp(marker, "g"), "\\");
}

function readExisting(tsvPath) {
  if (!fs.existsSync(tsvPath)) return new Map();
  const lines = fs.readFileSync(tsvPath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return new Map();
  const headers = lines.shift().split("\t");
  const byId = new Map();
  for (const line of lines) {
    const cols = line.split("\t");
    const row = {};
    headers.forEach((h, i) => {
      row[h] = unescapeTsv(cols[i] || "");
    });
    if (row.resource_id) byId.set(String(row.resource_id), row);
  }
  return byId;
}

const ids = parseIds(idsArg);
if (ids.length === 0) usage();

fs.mkdirSync(maskDir, { recursive: true });
const exportArgs = ["scripts/be-hdr-ui-tile-tool.js", "export", datPath, exePath, maskDir, ...ids.map(String)];
if (invert) exportArgs.push("--invert");
exportArgs.push("--source-ink-indexes", sourceInkIndexes);
exportArgs.push("--lba", String(fs2Lba), "--sectors", String(fs2Sectors));
childProcess.execFileSync("node", exportArgs, { stdio: "inherit" });

const manifestPath = path.join(maskDir, "be-hdr-ui-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const existing = readExisting(outTsv);
const converter = path.join("scripts", "convert-pbm-image.py");

for (const rec of manifest) {
  const pngPath = path.join(path.dirname(rec.outPath), `${path.basename(rec.outPath, ".pbm")}.png`);
  try {
    childProcess.execFileSync("python", [converter, "pbm-to-png", rec.outPath, pngPath], { stdio: "inherit" });
  } catch (err) {
    console.warn(`warning: failed to write editable PNG for ${rec.outPath}: ${err.message}`);
  }
}

const headers = [
  "enabled",
  "resource_id",
  "source_pbm",
  "editable_png",
  "replacement_pbm",
  "replacement_png",
  "erase_pbm",
  "replacement_mode",
  "patch_regions",
  "source_note",
  "ko_text",
  "width",
  "height",
  "font_size",
  "line_height",
  "pad",
  "threshold",
  "bold",
  "invert",
  "source_ink_indexes",
  "ink_index",
  "bg_index",
  "lossy_fit",
  "lossy_protect_regions",
  "heal_regions",
  "heal_indexes",
  "heal_radius",
];

function exportResourceMask(id, rowSourceInkIndexes) {
  const args = ["scripts/be-hdr-ui-tile-tool.js", "export", datPath, exePath, maskDir, String(id)];
  if (invert) args.push("--invert");
  args.push("--source-ink-indexes", rowSourceInkIndexes);
  args.push("--lba", String(fs2Lba), "--sectors", String(fs2Sectors));
  childProcess.execFileSync("node", args, { stdio: "inherit" });
  const pbmPath = path.join(maskDir, `be-hdr-ui-${id}.pbm`);
  const pngPath = path.join(maskDir, `be-hdr-ui-${id}.png`);
  childProcess.execFileSync("python", [converter, "pbm-to-png", pbmPath, pngPath], { stdio: "inherit" });
  return { pbmPath, pngPath };
}

const rows = manifest.map((rec) => {
  const old = existing.get(String(rec.resourceId)) || {};
  const sourceNote =
    !old.source_note || String(old.source_note).includes("4bpp")
      ? `be-hdr 8bpp ${rec.width}x${rec.height}, tiles=${rec.tileCount}`
      : old.source_note;
  let rowSourceInkIndexes = !old.source_ink_indexes || old.source_ink_indexes === "14" ? sourceInkIndexes : old.source_ink_indexes;
  let rowInkIndex = !old.ink_index || old.ink_index === "15" ? inkIndex : old.ink_index;
  if (rec.resourceId === 827) {
    if (!old.source_ink_indexes || old.source_ink_indexes === "14" || old.source_ink_indexes === "224-232") {
      rowSourceInkIndexes = "1,2";
    }
    if (!old.ink_index || old.ink_index === "15" || old.ink_index === "232") {
      rowInkIndex = 2;
    }
  }
  let sourcePbm = rec.outPath;
  let editablePng = path.join(path.dirname(rec.outPath), `${path.basename(rec.outPath, ".pbm")}.png`);
  if (rowSourceInkIndexes !== sourceInkIndexes) {
    const exported = exportResourceMask(rec.resourceId, rowSourceInkIndexes);
    sourcePbm = exported.pbmPath;
    editablePng = exported.pngPath;
  }
  const rowBgIndex = !old.bg_index || old.bg_index === "0" ? bgIndex : old.bg_index;
  return {
    enabled: old.enabled || "",
    resource_id: rec.resourceId,
    source_pbm: sourcePbm,
    editable_png: editablePng,
    replacement_pbm: old.replacement_pbm || "",
    replacement_png: old.replacement_png || "",
    erase_pbm: old.erase_pbm || "",
    replacement_mode: old.replacement_mode || "",
    patch_regions: old.patch_regions || "",
    source_note: sourceNote,
    ko_text: old.ko_text || "",
    width: rec.width,
    height: rec.height,
    font_size: old.font_size || fontSize,
    line_height: old.line_height || lineHeight,
    pad: old.pad || pad,
    threshold: old.threshold || threshold,
    bold: old.bold || bold,
    invert: old.invert || (invert ? "1" : "0"),
    source_ink_indexes: rowSourceInkIndexes,
    ink_index: rowInkIndex,
    bg_index: rowBgIndex,
    lossy_fit: old.lossy_fit || "",
    lossy_protect_regions: old.lossy_protect_regions || "",
    heal_regions: old.heal_regions || "",
    heal_indexes: old.heal_indexes || "",
    heal_radius: old.heal_radius || "",
  };
});

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
fs.mkdirSync(path.dirname(outTsv), { recursive: true });
fs.writeFileSync(
  outTsv,
  `${headers.join("\t")}\n${rows.map((row) => headers.map((h) => escapeTsv(row[h])).join("\t")).join("\n")}\n`,
  "utf8"
);
console.log(`wrote ${outTsv}`);
