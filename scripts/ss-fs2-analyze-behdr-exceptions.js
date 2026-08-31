#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [ssBinPath, psOriginalDatPath, psPatchedDatPath, psExePath, outputPath] = process.argv.slice(2);
if (!outputPath) {
  console.error('usage: node scripts/ss-fs2-analyze-behdr-exceptions.js <ss.bin> <ps-original.dat> <ps-patched.dat> <ps-exe> <output.json>');
  process.exit(1);
}
const PAIRS = [[828,714],[1187,1073],[1188,1074],[1201,1087],[1202,1088]];
const RAW=2352, USER=2048, UOFF=16, SS_EXE_LBA=21, SS_EXE_BYTES=319524, SS_DATA_LBA=178, SS_TABLE=0x1ae9c;
const psOrig=fs.readFileSync(psOriginalDatPath), psPatched=fs.readFileSync(psPatchedDatPath), psExe=fs.readFileSync(psExePath);
const psLoad=psExe.readUInt32LE(0x18), psTable=0x801c4f68-psLoad+0x800;
const sha1=(b)=>crypto.createHash('sha1').update(b).digest('hex');
function readUser(fd,lba,bytes){const out=Buffer.alloc(bytes);for(let p=0;p<bytes;){const s=Math.floor(p/USER),w=p%USER,n=Math.min(USER-w,bytes-p);if(fs.readSync(fd,out,p,n,(lba+s)*RAW+UOFF+w)!==n)throw new Error('short read');p+=n}return out}
function info(data){
  const widthTiles=data.readUInt32BE(0),heightTiles=data.readUInt32BE(4),payloadSize=data.readUInt32BE(8),tileDataOffset=data.readUInt32BE(12);
  const tileMapOffset=tileDataOffset-widthTiles*heightTiles*2, cells=widthTiles*heightTiles;
  let max=-1; const map=[];
  for(let i=0;i<cells;i++){const v=data.readUInt16BE(tileMapOffset+i*2);map.push(v);max=Math.max(max,v>>1)}
  const tileCapacity=Math.floor((data.length-tileDataOffset)/64), tileCount=max+1;
  const pixels=Buffer.alloc(widthTiles*8*heightTiles*8), width=widthTiles*8;
  for(let ty=0;ty<heightTiles;ty++)for(let tx=0;tx<widthTiles;tx++){const idx=map[ty*widthTiles+tx]>>1;for(let y=0;y<8;y++)for(let x=0;x<8;x++)pixels[(ty*8+y)*width+tx*8+x]=data[tileDataOffset+idx*64+y*8+x]||0}
  return {widthTiles,heightTiles,width,height:heightTiles*8,payloadSize,tileMapOffset,tileDataOffset,tileCount,tileCapacity,palette:data.subarray(0x10,Math.min(tileMapOffset,0x210)),pixels};
}
const fd=fs.openSync(ssBinPath,'r'); let entries=[];
try{
  const exe=readUser(fd,SS_EXE_LBA,SS_EXE_BYTES), starts=[];let carry=0,prev=exe.readUInt16BE(SS_TABLE);
  for(let id=0;id<=4336;id++){const raw=exe.readUInt16BE(SS_TABLE+id*2);if(id&&raw<prev)carry+=0x10000;starts[id]=raw+carry;prev=raw}
  for(const [psId,ssId] of PAIRS){
    const psStart=psExe.readUInt16LE(psTable+psId*2)*USER,psEnd=psExe.readUInt16LE(psTable+(psId+1)*2)*USER;
    const po=psOrig.subarray(psStart,psEnd),pp=psPatched.subarray(psStart,psEnd);
    const ssLba=SS_DATA_LBA+starts[ssId],ss=readUser(fd,ssLba,(starts[ssId+1]-starts[ssId])*USER);
    const a=info(po),b=info(pp),c=info(ss);
    const strip=({palette,pixels,...x})=>x;
    entries.push({psId,ssId,ssLba,psSectors:po.length/USER,ssSectors:ss.length/USER,
      psOriginal:strip(a),psPatched:strip(b),ssOriginal:strip(c),
      sameDimensions:a.width===c.width&&a.height===c.height,
      samePalette:a.palette.equals(c.palette),
      originalPixelsEqual:a.pixels.equals(c.pixels),
      patchedPixelsEqual:b.pixels.equals(c.pixels),
      psChangedPixels:a.pixels.reduce((n,v,i)=>n+(v!==b.pixels[i]),0),
      originalPixelSha1:sha1(a.pixels),patchedPixelSha1:sha1(b.pixels),ssPixelSha1:sha1(c.pixels)});
  }
}finally{fs.closeSync(fd)}
const result={version:1,entries};fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(result,null,2));
for(const e of entries)console.log(`PS ${e.psId} -> SS ${e.ssId}: ${e.ssOriginal.width}x${e.ssOriginal.height}, palette=${e.samePalette}, originalPixels=${e.originalPixelsEqual}, changedPixels=${e.psChangedPixels}, capacity PS/SS=${e.psOriginal.tileCapacity}/${e.ssOriginal.tileCapacity}`);
console.log(`wrote ${outputPath}`);
