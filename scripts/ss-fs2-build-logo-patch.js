#!/usr/bin/env node

'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {recomputeMode1Sector,isMode1}=require('./cdrom-eccedc.js');
const [inputBin,outputBin,psOriginalDatPath,psPatchedDatPath,psExePath,reportPath]=process.argv.slice(2);
if(!reportPath){console.error('usage: node scripts/ss-fs2-build-logo-patch.js <input.bin> <output.bin> <ps-original.dat> <ps-patched.dat> <ps-exe> <report.json>');process.exit(1)}
if(path.resolve(inputBin)===path.resolve(outputBin))throw new Error('input and output BIN must differ');
const PAIRS=[{psId:251,ssId:222,mode:'exact-original'},{psId:288,ssId:259,mode:'same-structure-palette'}];
const RAW=2352,USER=2048,UOFF=16,SS_EXE_LBA=21,SS_EXE_BYTES=319524,SS_DATA_LBA=178,SS_TABLE=0x1ae9c;
const po=fs.readFileSync(psOriginalDatPath),pp=fs.readFileSync(psPatchedDatPath),pe=fs.readFileSync(psExePath),load=pe.readUInt32LE(0x18),pt=0x801c4f68-load+0x800;
const sha1=b=>crypto.createHash('sha1').update(b).digest('hex');
function readUser(fd,lba,bytes){const o=Buffer.alloc(bytes);for(let p=0;p<bytes;){const s=Math.floor(p/USER),w=p%USER,n=Math.min(USER-w,bytes-p);if(fs.readSync(fd,o,p,n,(lba+s)*RAW+UOFF+w)!==n)throw new Error('short read');p+=n}return o}
function header(d){const wt=d.readUInt32BE(0),ht=d.readUInt32BE(4),payload=d.readUInt32BE(8),td=d.readUInt32BE(12),mo=td-wt*ht*2;return{wt,ht,payload,td,mo,palette:d.subarray(0x10,Math.min(mo,0x210))}}
function write(fd,lba,data,touched){for(let p=0;p<data.length;p+=USER){const s=Buffer.alloc(RAW),n=lba+p/USER,o=n*RAW;if(fs.readSync(fd,s,0,RAW,o)!==RAW||!isMode1(s))throw new Error(`invalid Mode 1 LBA ${n}`);data.copy(s,UOFF,p,p+USER);recomputeMode1Sector(s);fs.writeSync(fd,s,0,RAW,o);touched.add(n)}}
const inFd=fs.openSync(inputBin,'r'),se=readUser(inFd,SS_EXE_LBA,SS_EXE_BYTES),starts=[];let carry=0,prev=se.readUInt16BE(SS_TABLE);
for(let id=0;id<=4336;id++){let raw=se.readUInt16BE(SS_TABLE+id*2);if(id&&raw<prev)carry+=0x10000;starts[id]=raw+carry;prev=raw}
const items=[];
try{for(const pair of PAIRS){const psStart=pe.readUInt16LE(pt+pair.psId*2)*USER,psEnd=pe.readUInt16LE(pt+(pair.psId+1)*2)*USER,orig=po.subarray(psStart,psEnd),patched=pp.subarray(psStart,psEnd),ssLba=SS_DATA_LBA+starts[pair.ssId],ss=readUser(inFd,ssLba,(starts[pair.ssId+1]-starts[pair.ssId])*USER);if(orig.length!==ss.length||patched.length!==ss.length)throw new Error(`${pair.psId}/${pair.ssId}: size mismatch`);const a=header(orig),b=header(ss);if(a.wt!==b.wt||a.ht!==b.ht||a.td!==b.td||a.mo!==b.mo||!a.palette.equals(b.palette))throw new Error(`${pair.psId}/${pair.ssId}: structure/palette mismatch`);if(pair.mode==='exact-original'&&!orig.equals(ss))throw new Error(`${pair.psId}/${pair.ssId}: original mismatch`);if(orig.equals(patched))throw new Error(`${pair.psId}: latest resource unchanged`);items.push({...pair,ssLba,sectors:ss.length/USER,patched,patchedSha1:sha1(patched)})}}finally{fs.closeSync(inFd)}
fs.copyFileSync(inputBin,outputBin);const out=fs.openSync(outputBin,'r+'),touched=new Set();try{for(const x of items){write(out,x.ssLba,x.patched,touched);if(!readUser(out,x.ssLba,x.patched.length).equals(x.patched))throw new Error(`${x.ssId}: verify failed`)}}finally{fs.closeSync(out)}
const report={version:1,inputBin,outputBin,applied:items.length,touchedSectors:touched.size,results:items.map(({patched,...x})=>x)};fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(`applied=${report.applied} touchedSectors=${report.touchedSectors}`);for(const x of report.results)console.log(`PS ${x.psId} -> SS ${x.ssId}: ${x.mode}, LBA ${x.ssLba}, sectors ${x.sectors}`);console.log(`wrote ${outputBin}`);console.log(`report ${reportPath}`);
