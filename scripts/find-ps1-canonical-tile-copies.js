#!/usr/bin/env node
// Find 8bpp tile copies while ignoring palette-index renumbering.
const fs = require('fs');
const dat = fs.readFileSync(process.argv[2]);
const exe = fs.readFileSync(process.argv[3]);
const sourceId = Number(process.argv[4] || 12);
const load = exe.readUInt32LE(0x18);
const table = 0x801c4f68 - load + 0x800;
const offsets = [];
let carry = 0, prev = 0;
for (let i = 0; i < 4338; i++) {
  const raw = exe.readUInt16LE(table + i * 2);
  if (i && raw < prev) carry += 0x10000;
  offsets.push((raw + carry) * 2048);
  prev = raw;
}
const base = offsets[sourceId];
const wt = dat.readUInt32BE(base), ht = dat.readUInt32BE(base + 4), td = dat.readUInt32BE(base + 12);
const mapBytes = wt * ht * 2;
const align4 = n => (n + 3) & ~3;
let mo = td - mapBytes;
if (align4(0x210 + mapBytes) === td) mo = 0x210;
else if (align4(0x10 + mapBytes) === td) mo = 0x10;
const [x,y,w,h] = (process.argv[5] || '130,29,63,15').split(',').map(Number);
const ids = new Set();
for (let py=y; py<y+h; py++) for (let px=x; px<x+w; px++) {
  ids.add(dat.readUInt16BE(base + mo + ((py>>3)*wt + (px>>3))*2) >> 1);
}
function canonicalAt(buf, p) {
  const labels = new Int16Array(256); labels.fill(-1);
  let next = 0, hash = 2166136261 >>> 0;
  for (let i=0;i<64;i++) {
    const v=buf[p+i];
    let n=labels[v]; if(n<0){n=next++;labels[v]=n;}
    hash ^= n; hash = Math.imul(hash, 16777619) >>> 0;
  }
  return [hash,next];
}
const wanted = new Map();
for (const id of ids) {
  const p=base+td+id*64, [hash,colors]=canonicalAt(dat,p);
  if(colors>1 && colors<=8) wanted.set(hash, {id,colors});
}
const counts = new Map();
let rid=0;
for(let p=0;p+64<=dat.length;p+=16){
  while(rid+1<offsets.length && p>=offsets[rid+1]) rid++;
  const [hash,colors]=canonicalAt(dat,p), src=wanted.get(hash);
  if(!src || src.colors!==colors) continue;
  const rec=counts.get(rid)||{ids:new Set(),hits:[]}; rec.ids.add(src.id);
  if(rec.hits.length<24) rec.hits.push(`${src.id}@0x${(p-offsets[rid]).toString(16)}`);
  counts.set(rid,rec);
}
// Also test packed 4bpp tiles (32 bytes -> 64 pixels), common for PS1 UI art.
function canonical4At(buf,p,highFirst){
  const labels=new Int16Array(16); labels.fill(-1);
  let next=0,hash=2166136261>>>0;
  for(let i=0;i<32;i++) for(let k=0;k<2;k++){
    const shift=highFirst?(k?0:4):(k?4:0),v=(buf[p+i]>>shift)&15;
    let n=labels[v]; if(n<0){n=next++;labels[v]=n;}
    hash^=n; hash=Math.imul(hash,16777619)>>>0;
  }
  return [hash,next];
}
const counts4=new Map(); rid=0;
for(let p=0;p+32<=dat.length;p+=16){
  while(rid+1<offsets.length && p>=offsets[rid+1]) rid++;
  for(const highFirst of [false,true]){
    const [hash,colors]=canonical4At(dat,p,highFirst),src=wanted.get(hash);
    if(!src||src.colors!==colors) continue;
    const rec=counts4.get(rid)||{ids:new Set(),hits:[]};rec.ids.add(src.id);
    if(rec.hits.length<24)rec.hits.push(`${src.id}@0x${(p-offsets[rid]).toString(16)}${highFirst?'H':'L'}`);
    counts4.set(rid,rec);
  }
}
const rows=[...counts].map(([rid,r])=>({rid,n:r.ids.size,h:r.hits})).sort((a,b)=>b.n-a.n);
console.log(`source=${sourceId} crop=${x},${y},${w},${h} canonicalTiles=${wanted.size}`);
console.log('unique\tresource\toffset\tsize\thits');
for(const r of rows.slice(0,80)) console.log(`${r.n}\t${r.rid}\t0x${offsets[r.rid].toString(16)}\t0x${(offsets[r.rid+1]-offsets[r.rid]).toString(16)}\t${r.h.join(',')}`);
const rows4=[...counts4].map(([rid,r])=>({rid,n:r.ids.size,h:r.hits})).sort((a,b)=>b.n-a.n);
console.log('\n4bpp unique\tresource\toffset\tsize\thits');
for(const r of rows4.slice(0,80))console.log(`${r.n}\t${r.rid}\t0x${offsets[r.rid].toString(16)}\t0x${(offsets[r.rid+1]-offsets[r.rid]).toString(16)}\t${r.h.join(',')}`);
