#!/usr/bin/env node

'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto');
const [ssBinPath,psDatPath,psExePath,outputPath]=process.argv.slice(2);
if(!outputPath){console.error('usage: node scripts/ss-fs2-map-logo-resources.js <ss.bin> <ps.dat> <ps.exe> <output.json>');process.exit(1)}
const IDS=[251,288,287,300],RAW=2352,USER=2048,UOFF=16,SS_EXE_LBA=21,SS_EXE_BYTES=319524,SS_DATA_LBA=178,SS_TABLE=0x1ae9c,COUNT=4336;
const psDat=fs.readFileSync(psDatPath),psExe=fs.readFileSync(psExePath),psLoad=psExe.readUInt32LE(0x18),psTable=0x801c4f68-psLoad+0x800;
const sha1=b=>crypto.createHash('sha1').update(b).digest('hex');
function readUser(fd,lba,bytes){const o=Buffer.alloc(bytes);for(let p=0;p<bytes;){const s=Math.floor(p/USER),w=p%USER,n=Math.min(USER-w,bytes-p);if(fs.readSync(fd,o,p,n,(lba+s)*RAW+UOFF+w)!==n)throw new Error('short read');p+=n}return o}
function parse(data){try{const wt=data.readUInt32BE(0),ht=data.readUInt32BE(4),payload=data.readUInt32BE(8),td=data.readUInt32BE(12),mo=td-wt*ht*2;if(wt<1||ht<1||wt>128||ht>128||mo<0x10||td>=data.length||payload>data.length)return null;let max=-1,map=[];for(let i=0;i<wt*ht;i++){if(mo+i*2+2>data.length)return null;let v=data.readUInt16BE(mo+i*2);map.push(v);max=Math.max(max,v>>1)}if(td+(max+1)*64>data.length)return null;const width=wt*8,height=ht*8,pix=Buffer.alloc(width*height);for(let ty=0;ty<ht;ty++)for(let tx=0;tx<wt;tx++){let ti=map[ty*wt+tx]>>1;for(let y=0;y<8;y++)for(let x=0;x<8;x++)pix[(ty*8+y)*width+tx*8+x]=data[td+ti*64+y*8+x]}return{wt,ht,width,height,payload,tileMapOffset:mo,tileDataOffset:td,tileCount:max+1,tileCapacity:Math.floor((data.length-td)/64),paletteSha1:sha1(data.subarray(0x10,Math.min(mo,0x210))),pixelSha1:sha1(pix)}}catch{return null}}
const psEntries=IDS.map(id=>{const s=psExe.readUInt16LE(psTable+id*2),e=psExe.readUInt16LE(psTable+(id+1)*2),data=psDat.subarray(s*USER,e*USER);return{id,startSector:s,sectors:e-s,sha1:sha1(data),header:parse(data),data}});
const fd=fs.openSync(ssBinPath,'r');let result;
try{const exe=readUser(fd,SS_EXE_LBA,SS_EXE_BYTES),starts=[];let carry=0,prev=exe.readUInt16BE(SS_TABLE);for(let id=0;id<=COUNT;id++){let raw=exe.readUInt16BE(SS_TABLE+id*2);if(id&&raw<prev)carry+=0x10000;starts[id]=raw+carry;prev=raw}
 const candidates=[];for(let id=0;id<COUNT;id++){let sectors=starts[id+1]-starts[id];if(sectors<=0||sectors>128)continue;let data=readUser(fd,SS_DATA_LBA+starts[id],sectors*USER),header=parse(data);candidates.push({id,lba:SS_DATA_LBA+starts[id],sectors,sha1:sha1(data),header})}
 const entries=psEntries.map(p=>{const matches=candidates.filter(s=>s.sha1===p.sha1),samePixels=p.header?candidates.filter(s=>s.header&&s.header.width===p.header.width&&s.header.height===p.header.height&&s.header.pixelSha1===p.header.pixelSha1):[],sameGeometry=p.header?candidates.filter(s=>s.header&&s.header.width===p.header.width&&s.header.height===p.header.height):[];return{id:p.id,startSector:p.startSector,sectors:p.sectors,sha1:p.sha1,header:p.header,exactMatches:matches,samePixelMatches:samePixels,geometryCandidateCount:sameGeometry.length,geometryCandidates:sameGeometry.slice(0,100)}});
 result={version:1,inputs:{ssBinPath,psDatPath,psExePath},entries};
}finally{fs.closeSync(fd)}
fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(result,null,2));for(const e of result.entries)console.log(`PS ${e.id}: ${e.header?`${e.header.width}x${e.header.height}`:'unknown'}, exact=[${e.exactMatches.map(x=>x.id)}], pixels=[${e.samePixelMatches.map(x=>x.id)}], geometry=${e.geometryCandidateCount}`);console.log(`wrote ${outputPath}`);
