#!/usr/bin/env node

'use strict';

const fs=require('fs'),path=require('path');
const [binPath,idText,outPbm,widthText='288',heightText='64',strideText='36',offsetText='0']=process.argv.slice(2);
const id=Number(idText),width=Number(widthText),height=Number(heightText),stride=Number(strideText),dataOffset=Number(offsetText);
if(!binPath||![id,width,height,stride,dataOffset].every(Number.isSafeInteger)){console.error('usage: node scripts/ss-fs2-export-ui-mask.js <ss.bin> <resource-id> <out.pbm> [width=288] [height=64] [stride=36] [offset=0]');process.exit(1)}
const RAW=2352,USER=2048,UOFF=16,EXE_LBA=21,EXE_BYTES=319524,DATA_LBA=178,TABLE=0x1ae9c;
const fd=fs.openSync(binPath,'r');
function readUser(lba,bytes){const o=Buffer.alloc(bytes);for(let p=0;p<bytes;){const s=Math.floor(p/USER),w=p%USER,n=Math.min(USER-w,bytes-p);if(fs.readSync(fd,o,p,n,(lba+s)*RAW+UOFF+w)!==n)throw new Error('short read');p+=n}return o}
try{const exe=readUser(EXE_LBA,EXE_BYTES);let carry=0,prev=exe.readUInt16BE(TABLE),start,end;for(let n=0;n<=id+1;n++){const raw=exe.readUInt16BE(TABLE+n*2);if(n&&raw<prev)carry+=0x10000;if(n===id)start=raw+carry;if(n===id+1)end=raw+carry;prev=raw}const lba=DATA_LBA+start,resource=readUser(lba,(end-start)*USER);if(dataOffset+stride*height>resource.length)throw new Error('mask exceeds resource');const lines=['P1',`# SS resource ${id}, LBA ${lba}, offset ${dataOffset}`,`${width} ${height}`];for(let y=0;y<height;y++){const row=[];for(let x=0;x<width;x++){const byte=resource[dataOffset+y*stride+(x>>3)],stored=(byte>>(7-(x&7)))&1;row.push(stored?'0':'1')}lines.push(row.join(' '))}fs.mkdirSync(path.dirname(outPbm),{recursive:true});fs.writeFileSync(outPbm,lines.join('\n')+'\n');console.log(`resource=${id} lba=${lba} sectors=${end-start} mask=${width}x${height} stride=${stride} offset=${dataOffset}`);console.log(`wrote ${outPbm}`)}finally{fs.closeSync(fd)}
