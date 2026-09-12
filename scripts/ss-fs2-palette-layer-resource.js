#!/usr/bin/env node
'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {recomputeMode1Sector,isMode1}=require('./cdrom-eccedc.js');
const RAW=2352,USER=2048,UOFF=16,EXE_LBA=21,EXE_BYTES=319524,DATA_LBA=178,TABLE=0x1ae9c,MAX_ID=4336;
const ALLOWED=new Set([0,1,2,11,12,14,15,16,18,19,20,21,226,228,234,236,239,240,257,714,1073,1074,1087,1088]);
const sha256=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
function usage(){console.error('usage:\n  node scripts/ss-fs2-palette-layer-resource.js export <input.bin> <work-dir> <id...>\n  node scripts/ss-fs2-palette-layer-resource.js apply <input.bin> <output.bin> <manifest.json> <report.json>');process.exit(1)}
function readUser(fd,lba,bytes){const out=Buffer.alloc(bytes);for(let p=0;p<bytes;){const s=Math.floor(p/USER),w=p%USER,n=Math.min(USER-w,bytes-p);if(fs.readSync(fd,out,p,n,(lba+s)*RAW+UOFF+w)!==n)throw new Error(`short read LBA ${lba+s}`);p+=n}return out}
function starts(fd){const e=readUser(fd,EXE_LBA,EXE_BYTES),a=[];let carry=0,prev=e.readUInt16BE(TABLE);for(let id=0;id<=MAX_ID;id++){const v=e.readUInt16BE(TABLE+id*2);if(id&&v<prev)carry+=0x10000;a[id]=v+carry;prev=v}return a}
function parse(d){const wt=d.readUInt32BE(0),ht=d.readUInt32BE(4),td=d.readUInt32BE(12),entries=wt*ht,mapBytes=entries*2,align4=n=>(n+3)&~3;let mo=-1;if(align4(0x210+mapBytes)===td)mo=0x210;else if(align4(0x10+mapBytes)===td)mo=0x10;const width=wt*8,height=ht*8,cap=Math.floor((d.length-td)/64),map=[];if(wt<1||ht<1||mo<0x10||td>d.length)throw new Error(`invalid be-hdr resource: ${JSON.stringify({wt,ht,td,mapBytes})}`);for(let i=0;i<entries;i++)map.push(d.readUInt16BE(mo+i*2));const pix=Buffer.alloc(width*height);for(let ty=0;ty<ht;ty++)for(let tx=0;tx<wt;tx++){const ti=map[ty*wt+tx]>>1;if(ti>=cap)throw new Error(`tile ${ti} exceeds capacity ${cap}`);for(let y=0;y<8;y++)d.copy(pix,(ty*8+y)*width+tx*8,td+ti*64+y*8,td+ti*64+y*8+8)}return{wt,ht,td,mo,width,height,cap,map,pix}}
function writePgm(p,w,h,pix){const rows=['P2','# SS FS2 raw 8bpp palette indexes',`${w} ${h}`,'255'];for(let y=0;y<h;y++)rows.push([...pix.subarray(y*w,(y+1)*w)].join(' '));fs.writeFileSync(p,rows.join('\n')+'\n')}
function readPgm(p){const toks=fs.readFileSync(p,'utf8').replace(/#[^\r\n]*/g,' ').trim().split(/\s+/);if(toks.shift()!=='P2')throw new Error(`${p}: expected P2 PGM`);const w=+toks.shift(),h=+toks.shift(),max=+toks.shift(),pix=Buffer.from(toks.map(Number));if(max!==255||pix.length!==w*h)throw new Error(`${p}: invalid PGM dimensions/data`);return{w,h,pix}}
function key(tile){return tile.toString('latin1')}
function tileAt(p,w,tx,ty){const t=Buffer.alloc(64);for(let y=0;y<8;y++)p.copy(t,y*8,(ty*8+y)*w+tx*8,(ty*8+y)*w+tx*8+8);return t}
function dedupeTiles(cellTiles){
  const tiles=[],byKey=new Map(),cells=[],counts=[];
  for(const t of cellTiles){
    const k=key(t);let index=byKey.get(k);
    if(index===undefined){index=tiles.length;tiles.push(t);counts.push(0);byKey.set(k,index)}
    counts[index]++;cells.push(index);
  }
  return{tiles,cells,counts};
}
function pack(d,info,pix){
  if(pix.equals(info.pix))return{data:Buffer.from(d),unique:new Set(info.map.map(v=>v>>1)).size,unchanged:true,lossyMerged:0,changedPixels:0,maxTileDistance:0};
  const cellTiles=[];for(let ty=0;ty<info.ht;ty++)for(let tx=0;tx<info.wt;tx++)cellTiles.push(tileAt(pix,info.width,tx,ty));
  const exact=dedupeTiles(cellTiles),packed={...exact,merged:0,totalDistance:0,maxDistance:0};
  if(packed.tiles.length>info.cap)throw new Error(`needs ${packed.tiles.length} unique tiles, capacity is ${info.cap}`);
  const out=Buffer.from(d);out.writeUInt32BE(0x10+packed.tiles.length*64,8);for(let i=0;i<packed.cells.length;i++)out.writeUInt16BE((packed.cells[i]<<1)|(info.map[i]&1),info.mo+i*2);out.fill(0,info.td);for(let i=0;i<packed.tiles.length;i++)packed.tiles[i].copy(out,info.td+i*64);
  return{data:out,unique:packed.tiles.length,unchanged:false,lossyMerged:packed.merged,changedPixels:packed.totalDistance,maxTileDistance:packed.maxDistance,originalUnique:exact.tiles.length};
}
function writeResource(fd,lba,d,touched){for(let p=0;p<d.length;p+=USER){const sec=Buffer.alloc(RAW),target=lba+p/USER,off=target*RAW;if(fs.readSync(fd,sec,0,RAW,off)!==RAW||!isMode1(sec))throw new Error(`invalid Mode 1 LBA ${target}`);d.copy(sec,UOFF,p,p+USER);recomputeMode1Sector(sec);fs.writeSync(fd,sec,0,RAW,off);touched.add(target)}}
function validateIds(ids){for(const id of ids)if(!ALLOWED.has(id))throw new Error(`SS resource ${id} is outside allowed set: ${[...ALLOWED].join(',')}`)}
const [cmd,...args]=process.argv.slice(2);if(!cmd)usage();
if(cmd==='export'){
  const [bin,dir,...texts]=args;if(!bin||!dir||!texts.length)usage();const ids=[...new Set(texts.map(Number))];for(const id of ids)if(!Number.isInteger(id)||id<0||id>=MAX_ID)throw new Error(`invalid SS resource ID ${id}`);fs.mkdirSync(dir,{recursive:true});const fd=fs.openSync(bin,'r'),st=starts(fd),items=[];
  try{for(const id of ids){const lba=DATA_LBA+st[id],bytes=(st[id+1]-st[id])*USER,d=readUser(fd,lba,bytes),i=parse(d),pgm=path.join(dir,`ss-fs2-resource-${id}-raw.pgm`);writePgm(pgm,i.width,i.height,i.pix);const counts=Array(256).fill(0);for(const v of i.pix)counts[v]++;items.push({id,lba,sectors:bytes/USER,width:i.width,height:i.height,tileCapacity:i.cap,paletteIndexCounts:counts.map((count,index)=>({index,count})).filter(x=>x.count),rawPgm:path.resolve(pgm)});console.log(`SS ${id}: ${i.width}x${i.height}, capacity=${i.cap}, wrote ${pgm}`)}}finally{fs.closeSync(fd)}
  const report={version:1,inputBin:path.resolve(bin),inputSha256:sha256(bin),items};fs.writeFileSync(path.join(dir,'ss-fs2-palette-export.json'),JSON.stringify(report,null,2));
}else if(cmd==='apply'){
  const [input,output,manifestPath,reportPath]=args;if(!reportPath)usage();if(path.resolve(input)===path.resolve(output))throw new Error('input and output BIN must differ');const m=JSON.parse(fs.readFileSync(manifestPath,'utf8')),ids=m.items.map(x=>Number(x.id));validateIds(ids);if(new Set(ids).size!==ids.length)throw new Error('duplicate resource IDs');const inFd=fs.openSync(input,'r'),st=starts(inFd),prepared=[];
  try{for(const x of m.items){const id=Number(x.id),lba=DATA_LBA+st[id],bytes=(st[id+1]-st[id])*USER,d=readUser(inFd,lba,bytes),i=parse(d),p=readPgm(x.pgm);if(p.w!==i.width||p.h!==i.height)throw new Error(`SS ${id}: PGM ${p.w}x${p.h}, expected ${i.width}x${i.height}`);const packed=pack(d,i,p.pix);prepared.push({id,lba,data:packed.data,width:i.width,height:i.height,uniqueTiles:packed.unique,capacity:i.cap,unchanged:packed.unchanged,originalUniqueTiles:packed.originalUnique??packed.unique,lossyMerged:packed.lossyMerged,changedPixels:packed.changedPixels,maxTileDistance:packed.maxTileDistance})}}finally{fs.closeSync(inFd)}
  fs.copyFileSync(input,output);const outFd=fs.openSync(output,'r+'),touched=new Set();try{for(const x of prepared)if(!x.unchanged)writeResource(outFd,x.lba,x.data,touched)}finally{fs.closeSync(outFd)}
  const report={version:1,inputBin:path.resolve(input),inputSha256:sha256(input),outputBin:path.resolve(output),outputSha256:sha256(output),touchedSectors:touched.size,items:prepared.map(({data,...x})=>x)};fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(`wrote ${output}; touched sectors=${touched.size}`);console.log(`report ${reportPath}`);
}else usage();
