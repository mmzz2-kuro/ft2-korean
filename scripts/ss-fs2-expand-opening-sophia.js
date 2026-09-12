#!/usr/bin/env node
'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {recomputeMode1Sector,isMode1}=require('./cdrom-eccedc.js');
const [input,output,sophiaPgmPath,karinPgmPath,reportPath]=process.argv.slice(2);
if(!reportPath){console.error('usage: node scripts/ss-fs2-expand-opening-sophia.js <input.bin> <output.bin> <sophia.pgm> <karin.pgm> <report.json>');process.exit(2)}
if(path.resolve(input)===path.resolve(output))throw Error('input and output must differ');
const R=2352,U=2048,EXE_LBA=21,EXE_BYTES=319524,DATA_LBA=178,TABLE=0x1ae9c,COUNT=4335;
const DELTA=new Map([[240,2],[697,-1],[705,-1]]);
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
function readUser(fd,lba,n){const o=Buffer.alloc(n);for(let p=0;p<n;){const s=p>>11,w=p&2047,k=Math.min(U-w,n-p);if(fs.readSync(fd,o,p,k,(lba+s)*R+16+w)!==k)throw Error(`short read LBA ${lba+s}`);p+=k}return o}
function writeUser(fd,lba,d,touched){for(let p=0;p<d.length;p+=U){const sec=Buffer.alloc(R),target=lba+p/U,off=target*R;if(fs.readSync(fd,sec,0,R,off)!==R||!isMode1(sec))throw Error(`invalid Mode1 LBA ${target}`);d.copy(sec,16,p,p+U);recomputeMode1Sector(sec);fs.writeSync(fd,sec,0,R,off);touched.add(target)}}
function starts(exe){const a=[];let carry=0,prev=exe.readUInt16BE(TABLE);for(let i=0;i<=COUNT;i++){const v=exe.readUInt16BE(TABLE+i*2);if(i&&v<prev)carry+=65536;a[i]=v+carry;prev=v}return a}
function readPgm(p){const t=fs.readFileSync(p,'utf8').replace(/#[^\r\n]*/g,' ').trim().split(/\s+/);if(t.shift()!=='P2')throw Error('expected P2');const w=+t.shift(),h=+t.shift(),m=+t.shift(),pix=Buffer.from(t.map(Number));if(m!==255||pix.length!==w*h)throw Error('invalid PGM');return{w,h,pix}}
function parse(d){const wt=d.readUInt32BE(0),ht=d.readUInt32BE(4),td=d.readUInt32BE(12),entries=wt*ht,al=n=>(n+3)&~3;let mo=-1;if(al(0x210+entries*2)===td)mo=0x210;else if(al(0x10+entries*2)===td)mo=0x10;if(mo<0)throw Error('invalid BE-HDR');const map=[];for(let i=0;i<entries;i++)map.push(d.readUInt16BE(mo+i*2));return{wt,ht,td,mo,map,w:wt*8,h:ht*8}}
function tileAt(p,w,tx,ty){const t=Buffer.alloc(64);for(let y=0;y<8;y++)p.copy(t,y*8,(ty*8+y)*w+tx*8,(ty*8+y)*w+tx*8+8);return t}
function pack(original,bytes,pgm,name){const i=parse(original);if(pgm.w!==i.w||pgm.h!==i.h)throw Error(`PGM ${pgm.w}x${pgm.h}, expected ${i.w}x${i.h}`);const tiles=[],by=new Map(),cells=[];for(let ty=0;ty<i.ht;ty++)for(let tx=0;tx<i.wt;tx++){const t=tileAt(pgm.pix,i.w,tx,ty),k=t.toString('latin1');let n=by.get(k);if(n===undefined){n=tiles.length;tiles.push(t);by.set(k,n)}cells.push(n)}const cap=Math.floor((bytes-i.td)/64);if(tiles.length>cap)throw Error(`${name} needs ${tiles.length} tiles, expanded capacity ${cap}`);const out=Buffer.alloc(bytes);original.copy(out);out.writeUInt32BE(0x10+tiles.length*64,8);for(let n=0;n<cells.length;n++)out.writeUInt16BE((cells[n]<<1)|(i.map[n]&1),i.mo+n*2);out.fill(0,i.td);tiles.forEach((t,n)=>t.copy(out,i.td+n*64));return{data:out,unique:tiles.length,capacity:cap}}

const inFd=fs.openSync(input,'r'),exe=readUser(inFd,EXE_LBA,EXE_BYTES),old=starts(exe),neu=old.slice();let shift=0;
for(let id=0;id<COUNT;id++){neu[id]=old[id]+shift;shift+=DELTA.get(id)||0}neu[COUNT]=old[COUNT]+shift;if(shift!==0)throw Error(`allocation delta must sum to zero, got ${shift}`);
fs.copyFileSync(input,output);const outFd=fs.openSync(output,'r+'),touched=new Set();let sophiaPacked,karinPacked;
try{
 for(let id=240;id<=705;id++){
  const oldBytes=(old[id+1]-old[id])*U,newBytes=(neu[id+1]-neu[id])*U,original=readUser(inFd,DATA_LBA+old[id],oldBytes);
  let data=Buffer.alloc(newBytes);original.copy(data,0,0,Math.min(oldBytes,newBytes));
  if(id===240){sophiaPacked=pack(original,newBytes,readPgm(sophiaPgmPath),'Sophia');data=sophiaPacked.data}
  if(id===257){karinPacked=pack(original,newBytes,readPgm(karinPgmPath),'Karin');data=karinPacked.data}
  if((id===697||id===705)&&original.readUInt32BE(12)+(original.readUInt32BE(8)-16)>newBytes)throw Error(`donor ${id} does not fit shortened allocation`);
  writeUser(outFd,DATA_LBA+neu[id],data,touched);
 }
 for(let i=241;i<=705;i++)exe.writeUInt16BE(neu[i]&0xffff,TABLE+i*2);
 writeUser(outFd,EXE_LBA,exe,touched);
}finally{fs.closeSync(outFd);fs.closeSync(inFd)}
const report={version:1,input:path.resolve(input),output:path.resolve(output),inputSha256:sha(input),outputSha256:sha(output),sophia:{id:240,oldSectors:old[241]-old[240],newSectors:neu[241]-neu[240],uniqueTiles:sophiaPacked.unique,capacity:sophiaPacked.capacity},karin:{id:257,oldSectors:old[258]-old[257],newSectors:neu[258]-neu[257],uniqueTiles:karinPacked.unique,capacity:karinPacked.capacity},donors:[697,705].map(id=>({id,oldSectors:old[id+1]-old[id],newSectors:neu[id+1]-neu[id]})),touchedSectors:touched.size};
fs.mkdirSync(path.dirname(path.resolve(reportPath)),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(`wrote ${output}; Sophia ${sophiaPacked.unique}/${sophiaPacked.capacity}, Karin ${karinPacked.unique}/${karinPacked.capacity} tiles; touched ${touched.size} sectors`);
