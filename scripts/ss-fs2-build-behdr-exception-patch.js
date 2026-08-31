#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recomputeMode1Sector, isMode1 } = require('./cdrom-eccedc.js');

const [inputBin, outputBin, psOriginalDatPath, psPatchedDatPath, psExePath, reportPath] = process.argv.slice(2);
if (!reportPath) {
  console.error('usage: node scripts/ss-fs2-build-behdr-exception-patch.js <input.bin> <output.bin> <ps-original.dat> <ps-patched.dat> <ps-exe> <report.json>');
  process.exit(1);
}
if (path.resolve(inputBin) === path.resolve(outputBin)) throw new Error('input and output BIN must differ');
const PAIRS = [[828,714],[1187,1073],[1188,1074]];
const RAW=2352,USER=2048,UOFF=16,SS_EXE_LBA=21,SS_EXE_BYTES=319524,SS_DATA_LBA=178,SS_TABLE=0x1ae9c;
const psOrig=fs.readFileSync(psOriginalDatPath),psPatched=fs.readFileSync(psPatchedDatPath),psExe=fs.readFileSync(psExePath);
const psLoad=psExe.readUInt32LE(0x18),psTable=0x801c4f68-psLoad+0x800;
const sha1=(b)=>crypto.createHash('sha1').update(b).digest('hex');
function readUser(fd,lba,bytes){const out=Buffer.alloc(bytes);for(let p=0;p<bytes;){const s=Math.floor(p/USER),w=p%USER,n=Math.min(USER-w,bytes-p);if(fs.readSync(fd,out,p,n,(lba+s)*RAW+UOFF+w)!==n)throw new Error(`short read LBA ${lba+s}`);p+=n}return out}
function parse(data){
  const wt=data.readUInt32BE(0),ht=data.readUInt32BE(4),payloadSize=data.readUInt32BE(8),tileDataOffset=data.readUInt32BE(12);
  const mapOffset=tileDataOffset-wt*ht*2,width=wt*8,height=ht*8,capacity=Math.floor((data.length-tileDataOffset)/64),map=[];
  for(let i=0;i<wt*ht;i++)map.push(data.readUInt16BE(mapOffset+i*2));
  const pixels=Buffer.alloc(width*height);
  for(let ty=0;ty<ht;ty++)for(let tx=0;tx<wt;tx++){const idx=map[ty*wt+tx]>>1;for(let y=0;y<8;y++)for(let x=0;x<8;x++)pixels[(ty*8+y)*width+tx*8+x]=data[tileDataOffset+idx*64+y*8+x]||0}
  return {wt,ht,width,height,payloadSize,tileDataOffset,mapOffset,capacity,map,pixels};
}
function tileKey(pixels,width,tx,ty){const tile=Buffer.alloc(64);for(let y=0;y<8;y++)pixels.copy(tile,y*8,(ty*8+y)*width+tx*8,(ty*8+y)*width+tx*8+8);return tile.toString('latin1')}
function packSs(data,info,pixels){
  const out=Buffer.from(data),keys=[],indexByKey=new Map(),cellIndexes=[];
  for(let ty=0;ty<info.ht;ty++)for(let tx=0;tx<info.wt;tx++){const key=tileKey(pixels,info.width,tx,ty);let idx=indexByKey.get(key);if(idx===undefined){idx=keys.length;keys.push(key);indexByKey.set(key,idx)}cellIndexes.push(idx)}
  if(keys.length>info.capacity)return {ok:false,uniqueTiles:keys.length,capacity:info.capacity};
  for(let i=0;i<cellIndexes.length;i++)out.writeUInt16BE((cellIndexes[i]<<1)|(info.map[i]&1),info.mapOffset+i*2);
  for(let i=0;i<keys.length;i++)Buffer.from(keys[i],'latin1').copy(out,info.tileDataOffset+i*64);
  return {ok:true,data:out,uniqueTiles:keys.length,capacity:info.capacity};
}
function writeResource(fd,lba,data,touched){for(let p=0;p<data.length;p+=USER){const sector=Buffer.alloc(RAW),target=lba+p/USER,off=target*RAW;if(fs.readSync(fd,sector,0,RAW,off)!==RAW||!isMode1(sector))throw new Error(`invalid Mode 1 LBA ${target}`);data.copy(sector,UOFF,p,p+USER);recomputeMode1Sector(sector);fs.writeSync(fd,sector,0,RAW,off);touched.add(target)}}

const inputFd=fs.openSync(inputBin,'r'),ssExe=readUser(inputFd,SS_EXE_LBA,SS_EXE_BYTES),starts=[];let carry=0,prev=ssExe.readUInt16BE(SS_TABLE);
for(let id=0;id<=4336;id++){const raw=ssExe.readUInt16BE(SS_TABLE+id*2);if(id&&raw<prev)carry+=0x10000;starts[id]=raw+carry;prev=raw}
const prepared=[],results=[];
try{
  for(const [psId,ssId] of PAIRS){
    const psStart=psExe.readUInt16LE(psTable+psId*2)*USER,psEnd=psExe.readUInt16LE(psTable+(psId+1)*2)*USER;
    const po=parse(psOrig.subarray(psStart,psEnd)),pp=parse(psPatched.subarray(psStart,psEnd));
    const ssLba=SS_DATA_LBA+starts[ssId],ssData=readUser(inputFd,ssLba,(starts[ssId+1]-starts[ssId])*USER),ss=parse(ssData);
    if(po.width!==pp.width||po.height!==pp.height||po.width!==ss.width||po.height!==ss.height)throw new Error(`dimension mismatch PS ${psId}/SS ${ssId}`);
    const final=Buffer.from(ss.pixels);let deltaPixels=0,alreadySame=0;
    for(let i=0;i<final.length;i++)if(po.pixels[i]!==pp.pixels[i]){deltaPixels++;if(final[i]===pp.pixels[i])alreadySame++;final[i]=pp.pixels[i]}
    const packed=packSs(ssData,ss,final);
    const result={psId,ssId,ssLba,width:ss.width,height:ss.height,deltaPixels,alreadySame,uniqueTiles:packed.uniqueTiles,capacity:packed.capacity,applied:packed.ok};
    results.push(result);if(packed.ok)prepared.push({...result,data:packed.data});
  }
}finally{fs.closeSync(inputFd)}

fs.copyFileSync(inputBin,outputBin);const outFd=fs.openSync(outputBin,'r+'),touched=new Set();
try{for(const item of prepared){writeResource(outFd,item.ssLba,item.data,touched);const verify=readUser(outFd,item.ssLba,item.data.length);if(!verify.equals(item.data))throw new Error(`SS ${item.ssId}: verify failed`)}}finally{fs.closeSync(outFd)}
const report={version:1,inputBin,outputBin,lossyFit:false,attempted:results.length,applied:prepared.length,touchedSectors:touched.size,results,outputSha1:sha1(fs.readFileSync(outputBin))};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
for(const x of results)console.log(`PS ${x.psId} -> SS ${x.ssId}: delta=${x.deltaPixels}, unique=${x.uniqueTiles}/${x.capacity}, ${x.applied?'applied':'SKIPPED'}`);
console.log(`applied=${report.applied} touchedSectors=${report.touchedSectors}`);console.log(`wrote ${outputBin}`);console.log(`report ${reportPath}`);
