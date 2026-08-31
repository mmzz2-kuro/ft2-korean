#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const imagePath = process.argv[2] || path.join('ss', 'others', 'Farland Saga - Toki no Michishirube (Japan) (Track 1).bin');
const resourceId = Number(process.argv[3] || 152);
const outputPath = process.argv[4] || path.join('output', `ss-fs2-resource-${resourceId}-tiles.html`);

const SECTOR_RAW = 2352;
const USER_OFFSET = 0x10;
const FILE0_LBA = 21;
const FILE1_LBA = 178;
const TABLE_OFFSET = 0x1ae9c;

function readUserData(fd, lba, sectors) {
  const out = Buffer.alloc(sectors * 2048);
  const raw = Buffer.alloc(SECTOR_RAW);
  for (let i = 0; i < sectors; i += 1) {
    fs.readSync(fd, raw, 0, SECTOR_RAW, (lba + i) * SECTOR_RAW);
    raw.copy(out, i * 2048, USER_OFFSET, USER_OFFSET + 2048);
  }
  return out;
}

const fd = fs.openSync(imagePath, 'r');
const executable = readUserData(fd, FILE0_LBA, 157);
const startSector = executable.readUInt16BE(TABLE_OFFSET + resourceId * 2);
const endSector = executable.readUInt16BE(TABLE_OFFSET + (resourceId + 1) * 2);
if (endSector <= startSector) throw new Error(`invalid resource range: ${startSector}..${endSector}`);
const data = readUserData(fd, FILE1_LBA + startSector, endSector - startSector);
fs.closeSync(fd);

function stats(tileBytes) {
  const count = Math.floor(data.length / tileBytes);
  const seen = new Set();
  let zero = 0;
  let uniform = 0;
  for (let i = 0; i < count; i += 1) {
    const tile = data.subarray(i * tileBytes, (i + 1) * tileBytes);
    const hex = tile.toString('hex');
    seen.add(hex);
    if (tile.every((v) => v === 0)) zero += 1;
    if (tile.every((v) => v === tile[0])) uniform += 1;
  }
  return { tileBytes, count, unique: seen.size, zero, uniform };
}

const allStats = [8, 32, 64, 128].map(stats);
const encoded = data.toString('base64');
const rootId = `ss-fs2-resource-${resourceId}-viewer`;
const fragment = `<section id="${rootId}" class="ssfs2-viewer">
  <style>
    #${rootId}{font-family:var(--font-sans);color:var(--foreground);background:var(--background);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--spacing-4);max-width:760px;box-sizing:border-box}
    #${rootId} .controls{display:flex;gap:var(--spacing-3);align-items:end;flex-wrap:wrap;margin-bottom:var(--spacing-3)}
    #${rootId} label{display:grid;gap:var(--spacing-1);font-size:var(--text-sm)}
    #${rootId} select,#${rootId} input{color:var(--foreground);background:var(--background);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--spacing-2)}
    #${rootId} canvas{display:block;width:min(100%,640px);height:auto;aspect-ratio:1;image-rendering:pixelated;background:var(--muted);border:1px solid var(--border);border-radius:var(--radius-md)}
    #${rootId} .status{font-size:var(--text-sm);color:var(--muted-foreground);margin:var(--spacing-2) 0 0}
  </style>
  <div class="controls">
    <label>해석 방식<select class="format">
      <option value="1">1bpp · 8×8 · 8 bytes</option>
      <option value="4" selected>4bpp · 8×8 · 32 bytes</option>
      <option value="8">8bpp · 8×8 · 64 bytes</option>
      <option value="16">4bpp · 16×16 · 128 bytes</option>
    </select></label>
    <label>페이지<input class="page" type="range" min="0" value="0" step="1"></label>
  </div>
  <canvas width="512" height="512" aria-label="리소스 ${resourceId} 타일 미리보기"></canvas>
  <p class="status"></p>
  <script>
  (()=>{
    const root=document.getElementById('${rootId}');
    const bytes=Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0));
    const formats={1:{bpp:1,w:8,h:8,size:8},4:{bpp:4,w:8,h:8,size:32},8:{bpp:8,w:8,h:8,size:64},16:{bpp:4,w:16,h:16,size:128}};
    const select=root.querySelector('.format'),page=root.querySelector('.page'),canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d'),status=root.querySelector('.status');
    const css=getComputedStyle(root),bg=css.getPropertyValue('--background').trim(),fg=css.getPropertyValue('--foreground').trim();
    function color(v,max){ctx.globalAlpha=.08+.92*(v/max);return fg}
    function draw(){
      const f=formats[select.value],total=Math.floor(bytes.length/f.size),perPage=256,pages=Math.ceil(total/perPage),p=Math.min(+page.value,pages-1);
      page.max=Math.max(0,pages-1);page.value=p;ctx.globalAlpha=1;ctx.fillStyle=bg;ctx.fillRect(0,0,512,512);
      const cell=32,scale=cell/f.w,start=p*perPage,end=Math.min(total,start+perPage);
      for(let t=start;t<end;t++){
        const ox=((t-start)%16)*cell,oy=Math.floor((t-start)/16)*cell,base=t*f.size;
        for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++){
          let v,max;
          if(f.bpp===1){v=(bytes[base+y]>>(7-x))&1;max=1}
          else if(f.bpp===4){const b=bytes[base+y*(f.w/2)+(x>>1)];v=(x&1)?b&15:b>>4;max=15}
          else{v=bytes[base+y*f.w+x];max=255}
          ctx.fillStyle=color(v,max);ctx.fillRect(ox+x*scale,oy+y*scale,scale,scale);
        }
      }
      ctx.globalAlpha=1;status.textContent='타일 '+start+'–'+(end-1)+' / '+(total-1)+' · 페이지 '+(p+1)+'/'+pages+' · 바이트 0x'+(start*f.size).toString(16)+'–0x'+(end*f.size-1).toString(16);
    }
    select.addEventListener('change',()=>{page.value=0;draw()});page.addEventListener('input',draw);draw();
  })();
  </script>
</section>\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, fragment, 'utf8');
console.log(JSON.stringify({ imagePath, resourceId, startSector, endSector, size: data.length, outputPath, stats: allStats }, null, 2));
