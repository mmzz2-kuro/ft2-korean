#!/usr/bin/env node

'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {recomputeMode1Sector,isMode1}=require('./cdrom-eccedc.js');
const [inputBin,outputBin,pbm930,pbm1053,reportPath]=process.argv.slice(2);
if(!reportPath){console.error('usage: node scripts/ss-fs2-build-ui-mask-exceptions.js <input.bin> <output.bin> <930-ko.pbm> <1053-ko.pbm> <report.json>');process.exit(1)}
if(path.resolve(inputBin)===path.resolve(outputBin))throw new Error('input and output BIN must differ');
const ITEMS=[{psId:930,ssId:816,pbm:pbm930},{psId:1053,ssId:939,pbm:pbm1053}],RAW=2352,USER=2048,UOFF=16,EXE_LBA=21,EXE_BYTES=319524,DATA_LBA=178,TABLE=0x1ae9c,WIDTH=288,HEIGHT=64,STRIDE=36;
function readUser(fd,lba,bytes){const o=Buffer.alloc(bytes);for(let p=0;p<bytes;){const s=Math.floor(p/USER),w=p%USER,n=Math.min(USER-w,bytes-p);if(fs.readSync(fd,o,p,n,(lba+s)*RAW+UOFF+w)!==n)throw new Error(`short read LBA ${lba+s}`);p+=n}return o}
function readPbm(file){const tok=fs.readFileSync(file,'utf8').split(/\r?\n/).flatMap(x=>x.replace(/#.*/,'').trim().split(/\s+/).filter(Boolean));if(tok.shift()!=='P1'||Number(tok.shift())!==WIDTH||Number(tok.shift())!==HEIGHT)throw new Error(`${file}: expected P1 288x64`);const out=Buffer.alloc(STRIDE*HEIGHT,0xff);for(let i=0;i<WIDTH*HEIGHT;i++)if(tok[i]==='1'){const y=Math.floor(i/WIDTH),x=i%WIDTH;out[y*STRIDE+(x>>3)]&=~(1<<(7-(x&7)))}return out}
function write(fd,lba,data,touched){for(let p=0;p<data.length;){const si=Math.floor(p/USER),w=p%USER,n=Math.min(USER-w,data.length-p),target=lba+si,s=Buffer.alloc(RAW),off=target*RAW;if(fs.readSync(fd,s,0,RAW,off)!==RAW||!isMode1(s))throw new Error(`invalid Mode 1 LBA ${target}`);data.copy(s,UOFF+w,p,p+n);recomputeMode1Sector(s);fs.writeSync(fd,s,0,RAW,off);touched.add(target);p+=n}}
const inFd=fs.openSync(inputBin,'r'),exe=readUser(inFd,EXE_LBA,EXE_BYTES),starts=[];let carry=0,prev=exe.readUInt16BE(TABLE);
for(let id=0;id<=940;id++){let raw=exe.readUInt16BE(TABLE+id*2);if(id&&raw<prev)carry+=0x10000;starts[id]=raw+carry;prev=raw}
const prepared=[];try{for(const item of ITEMS){if(!item.pbm||!fs.existsSync(item.pbm))throw new Error(`missing PBM for PS ${item.psId}`);const lba=DATA_LBA+starts[item.ssId],resourceBytes=(starts[item.ssId+1]-starts[item.ssId])*USER;if(resourceBytes<STRIDE*HEIGHT)throw new Error(`SS ${item.ssId}: resource too small`);prepared.push({...item,lba,data:readPbm(item.pbm),before:readUser(inFd,lba,STRIDE*HEIGHT)})}}finally{fs.closeSync(inFd)}
fs.copyFileSync(inputBin,outputBin);const out=fs.openSync(outputBin,'r+'),touched=new Set(),results=[];try{for(const x of prepared){write(out,x.lba,x.data,touched);if(!readUser(out,x.lba,x.data.length).equals(x.data))throw new Error(`SS ${x.ssId}: verify failed`);let changed=0;for(let i=0;i<x.data.length;i++)changed+=x.data[i]!==x.before[i];results.push({psId:x.psId,ssId:x.ssId,lba:x.lba,bytes:x.data.length,changedBytes:changed,pbm:x.pbm,sha1:crypto.createHash('sha1').update(x.data).digest('hex')})}}finally{fs.closeSync(out)}
const report={version:1,inputBin,outputBin,applied:results.length,touchedSectors:touched.size,results};fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(`applied=${report.applied} touchedSectors=${report.touchedSectors}`);for(const x of results)console.log(`PS ${x.psId} -> SS ${x.ssId}: LBA ${x.lba}, changedBytes=${x.changedBytes}`);console.log(`wrote ${outputBin}`);console.log(`report ${reportPath}`);
