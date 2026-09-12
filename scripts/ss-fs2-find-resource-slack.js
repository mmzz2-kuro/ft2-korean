#!/usr/bin/env node
'use strict';
const fs=require('fs');
const [bin]=process.argv.slice(2);if(!bin){console.error('usage: node scripts/ss-fs2-find-resource-slack.js <track1.bin>');process.exit(2)}
const R=2352,U=2048,fd=fs.openSync(bin,'r');
function read(lba,n){const o=Buffer.alloc(n);for(let p=0;p<n;){const s=p>>11,w=p&2047,k=Math.min(U-w,n-p);if(fs.readSync(fd,o,p,k,(lba+s)*R+16+w)!==k)throw Error('short read');p+=k}return o}
const e=read(21,319524),t=0x1ae9c,a=[];let carry=0,prev=e.readUInt16BE(t);
for(let i=0;i<=4335;i++){const v=e.readUInt16BE(t+i*2);if(i&&v<prev)carry+=65536;a[i]=v+carry;prev=v}
let total=0,hits=[];
for(let id=0;id<4335;id++){
 const allocated=a[id+1]-a[id];if(allocated<1)continue;
 const d=read(178+a[id],Math.min(U,allocated*U));if(d.length<16)continue;
 const wt=d.readUInt32BE(0),ht=d.readUInt32BE(4),size=d.readUInt32BE(8),td=d.readUInt32BE(12),entries=wt*ht;
 if(wt<1||ht<1||wt>200||ht>200||td<16||td>allocated*U||size<16)continue;
 const al=n=>(n+3)&~3;if(al(0x10+entries*2)!==td&&al(0x210+entries*2)!==td)continue;
 const used=td+(size-16),minimum=Math.ceil(used/U),slack=allocated-minimum;
 if(slack>0){hits.push({id,lba:178+a[id],allocated,minimum,slack,wt,ht,size,td});total+=slack}
}
fs.closeSync(fd);console.log(JSON.stringify({totalSlackSectors:total,hits},null,2));
