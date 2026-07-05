#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const datPath = args.shift();
const exePath = args.shift();
const outPath = args.shift();

let start = 4277;
let count = 173;
let dataOffset = 0;
let dataOffsets = null;
let limitBytes = 0xd80;
let columns = 2;
let scale = 2;
let views = ["byte64", "1bpp128", "1bpp256", "2bpp128", "4bpp128", "8bpp64", "16bpp64"];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--start") start = Number(args[++i]);
  else if (arg === "--count") count = Number(args[++i]);
  else if (arg === "--data-offset") dataOffset = Number(args[++i]);
  else if (arg === "--offsets") {
    dataOffsets = args[++i].split(",").map((value) => Number(value.trim()));
  }
  else if (arg === "--limit-bytes") limitBytes = Number(args[++i]);
  else if (arg === "--columns") columns = Number(args[++i]);
  else if (arg === "--scale") scale = Number(args[++i]);
  else if (arg === "--views") views = args[++i].split(",").map((v) => v.trim()).filter(Boolean);
  else {
    console.error(`unknown option: ${arg}`);
    process.exit(2);
  }
}

if (!datPath || !exePath || !outPath || !Number.isFinite(start) || !Number.isFinite(count)) {
  console.error(
    "usage: node scripts/export-fs2-message-candidate-html.js <FS2_FILE.DAT> <SLPS_019.03> <out.html> [--start ID] [--count N] [--data-offset N] [--limit-bytes N] [--views byte64,1bpp128,1bpp256,2bpp128,4bpp128,8bpp64,16bpp64] [--columns N] [--scale N]"
  );
  process.exit(2);
}

const dat = fs.readFileSync(datPath);
const exe = fs.readFileSync(exePath);
const load = exe.readUInt32LE(0x18);
const tableOff = 0x801c4f68 - load + 0x800;

function hex(n, width = 0) {
  return "0x" + n.toString(16).padStart(width, "0");
}

function parseView(view) {
  const match = /^(byte|1bpp|2bpp|4bpp|8bpp|16bpp)(\d+)$/.exec(view);
  if (!match) {
    console.error(`invalid view: ${view}`);
    process.exit(2);
  }
  return { name: view, mode: match[1], width: Number(match[2]) };
}

function resourceRange(id) {
  const startSector = exe.readUInt16LE(tableOff + id * 2);
  const endSector = exe.readUInt16LE(tableOff + (id + 1) * 2);
  if (endSector <= startSector) return null;
  return {
    id,
    startSector,
    endSector,
    off: startSector * 0x800,
    size: (endSector - startSector) * 0x800,
  };
}

function stats(buf) {
  let zero = 0;
  let ff = 0;
  let fe = 0;
  let nonzero = 0;
  const hist = new Map();
  for (const b of buf) {
    if (b === 0) zero += 1;
    if (b === 0xff) ff += 1;
    if (b === 0xfe) fe += 1;
    if (b !== 0) nonzero += 1;
    hist.set(b, (hist.get(b) || 0) + 1);
  }
  const top = [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([b, n]) => `${hex(b, 2)}:${n}`)
    .join(" ");
  return { zero, ff, fe, nonzero, top };
}

function pixelValue(buf, view, x, y) {
  if (view.mode === "byte") {
    const pos = y * view.width + x;
    return pos < buf.length ? buf[pos] : 0;
  }

  if (view.mode === "1bpp") {
    const pos = y * Math.ceil(view.width / 8) + Math.floor(x / 8);
    if (pos >= buf.length) return 0;
    return ((buf[pos] >> (7 - (x & 7))) & 1) ? 255 : 0;
  }

  if (view.mode === "2bpp") {
    const pos = y * Math.ceil(view.width / 4) + Math.floor(x / 4);
    if (pos >= buf.length) return 0;
    const shift = (x & 3) * 2;
    return ((buf[pos] >> shift) & 3) * 85;
  }

  if (view.mode === "4bpp") {
    const pos = y * Math.ceil(view.width / 2) + Math.floor(x / 2);
    if (pos >= buf.length) return 0;
    const nibble = x & 1 ? buf[pos] >> 4 : buf[pos] & 0x0f;
    return nibble * 17;
  }

  if (view.mode === "8bpp") {
    const pos = y * view.width + x;
    return pos < buf.length ? buf[pos] : 0;
  }

  if (view.mode === "16bpp") {
    const pos = (y * view.width + x) * 2;
    if (pos + 1 >= buf.length) return 0;
    const value = buf.readUInt16LE(pos);
    const r = value & 0x1f;
    const g = (value >> 5) & 0x1f;
    const b = (value >> 10) & 0x1f;
    return Math.round(((r + g + b) / 93) * 255);
  }

  return 0;
}

function renderRows(buf, view) {
  let bytesPerRow;
  if (view.mode === "byte") bytesPerRow = view.width;
  else if (view.mode === "1bpp") bytesPerRow = Math.ceil(view.width / 8);
  else if (view.mode === "2bpp") bytesPerRow = Math.ceil(view.width / 4);
  else if (view.mode === "4bpp") bytesPerRow = Math.ceil(view.width / 2);
  else if (view.mode === "8bpp") bytesPerRow = view.width;
  else bytesPerRow = view.width * 2;

  const height = Math.ceil(buf.length / bytesPerRow);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < view.width; x += 1) {
      const v = pixelValue(buf, view, x, y);
      row += String.fromCharCode(65 + Math.min(25, Math.floor(v / 10.2)));
    }
    rows.push(row);
  }
  return { width: view.width, height, rows };
}

const parsedViews = views.map(parseView);
const offsets = dataOffsets || [dataOffset];
const cells = [];

for (let id = start; id < start + count; id += 1) {
  const range = resourceRange(id);
  if (!range) {
    cells.push({ id, invalid: true });
    continue;
  }
  for (const offset of offsets) {
    if (!Number.isFinite(offset) || offset < 0 || offset >= range.size) continue;
    const chunkStart = range.off + offset;
    const available = Math.max(0, range.size - offset);
    const useBytes = Math.min(limitBytes, available);
    const raw = dat.subarray(chunkStart, chunkStart + useBytes);
    const st = stats(raw);
    const first = [...raw.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const post = Buffer.from(raw);
    for (let i = 0; i < post.length; i += 1) {
      if (post[i] === 0) post[i] = 0xfe;
    }

    cells.push({
      id,
      dataOffset: offset,
      off: hex(range.off + offset, 7),
      baseOff: hex(range.off, 7),
      size: hex(range.size, 5),
      startSector: range.startSector,
      endSector: range.endSector,
      used: hex(useBytes, 4),
      first,
      stats: st,
      views: parsedViews.map((view) => ({
        name: view.name,
        raw: renderRows(raw, view),
        post: renderRows(post, view),
      })),
    });
  }
}

const maxCanvasWidth = Math.max(...cells.flatMap((cell) => cell.views ? cell.views.map((view) => view.raw.width) : [1]));
const html = `<!doctype html>
<meta charset="utf-8">
<title>SLPS-01903 message/font candidates ${start}-${start + count - 1}</title>
<style>
body { margin: 16px; background: #f5f5f2; color: #202124; font-family: Consolas, "Courier New", monospace; }
h1 { font-size: 18px; margin: 0 0 6px; }
p { font-size: 12px; margin: 4px 0 14px; line-height: 1.45; max-width: 1200px; }
.grid { display: grid; grid-template-columns: repeat(${columns}, minmax(0, max-content)); gap: 12px; align-items: start; }
.cell { background: white; border: 1px solid #c9c9c0; padding: 8px; }
.head { display: flex; justify-content: space-between; gap: 18px; font-size: 12px; margin-bottom: 5px; }
.meta { font-size: 11px; color: #4b4b47; margin-bottom: 8px; max-width: ${Math.max(360, maxCanvasWidth * scale * 2 + 32)}px; white-space: normal; overflow-wrap: anywhere; }
.views { display: grid; grid-template-columns: repeat(2, max-content); gap: 8px 10px; }
.view { border-top: 1px solid #e0e0da; padding-top: 6px; }
.view-title { font-size: 11px; margin-bottom: 3px; color: #30302c; }
.pair { display: flex; gap: 6px; }
.pane-label { font-size: 10px; color: #6a6a64; margin-bottom: 2px; }
canvas { image-rendering: pixelated; display: block; border: 1px solid #ddd; background: #fff; }
</style>
<h1>SLPS-01903 Message/Font Candidates ${start}-${start + count - 1}</h1>
<p>
Each resource is rendered multiple ways because the real format is still unknown.
Left panes use raw bytes. Right panes apply the same preprocessing seen in <code>0x8017FF00</code>, replacing <code>0x00</code> with <code>0xFE</code>.
If this is the real text/font path, readable shapes are more likely to appear in one of the bitplane views than in Shift-JIS text.
</p>
<main class="grid">
${cells
  .map((cell, cellIndex) => {
    if (cell.invalid) {
      return `<section class="cell"><div class="head"><b>ID ${cell.id}</b><span>invalid/wrap</span></div></section>`;
    }
    return `<section class="cell">
  <div class="head"><b>ID ${cell.id} + ${hex(cell.dataOffset)}</b><span>${cell.off} / ${cell.size}</span></div>
  <div class="meta">sectors ${cell.startSector}..${cell.endSector}, base ${cell.baseOff}, used ${cell.used}<br>zero=${cell.stats.zero}, fe=${cell.stats.fe}, ff=${cell.stats.ff}, nonzero=${cell.stats.nonzero}, top ${cell.stats.top}<br>first ${cell.first}</div>
  <div class="views">
  ${cell.views
    .map(
      (view, viewIndex) => `<div class="view">
    <div class="view-title">${view.name}</div>
    <div class="pair">
      <div><div class="pane-label">raw</div><canvas id="c${cellIndex}_${viewIndex}_r" width="${view.raw.width}" height="${view.raw.height}" style="width:${view.raw.width * scale}px;height:${view.raw.height * scale}px"></canvas></div>
      <div><div class="pane-label">00-&gt;FE</div><canvas id="c${cellIndex}_${viewIndex}_p" width="${view.post.width}" height="${view.post.height}" style="width:${view.post.width * scale}px;height:${view.post.height * scale}px"></canvas></div>
    </div>
  </div>`
    )
    .join("\n")}
  </div>
</section>`;
  })
  .join("\n")}
</main>
<script>
const cells = ${JSON.stringify(cells)};
function draw(id, view) {
  const canvas = document.getElementById(id);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < view.rows.length; y++) {
    const row = view.rows[y];
    for (let x = 0; x < row.length; x++) {
      const p = (y * canvas.width + x) * 4;
      const v = 255 - Math.round(((row.charCodeAt(x) - 65) / 25) * 255);
      image.data[p] = v;
      image.data[p + 1] = v;
      image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
cells.forEach((cell, cellIndex) => {
  if (!cell.views) return;
  cell.views.forEach((view, viewIndex) => {
    draw("c" + cellIndex + "_" + viewIndex + "_r", view.raw);
    draw("c" + cellIndex + "_" + viewIndex + "_p", view.post);
  });
});
</script>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`wrote ${outPath} ids=${start}-${start + count - 1} views=${views.join(",")} limit=${hex(limitBytes)}`);
