#!/usr/bin/env node

'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const [track1,track2,psLatestBin,outputBin,outputCue,reportPath,workArg]=process.argv.slice(2);
if(!reportPath){console.error('usage: node scripts/ss-fs2-build-final.js <ss-track1.bin> <ss-track2.bin> <latest-ps1.bin> <output.bin> <output.cue> <report.json> [work-dir]');process.exit(1)}
const ROOT=path.resolve(__dirname,'..'),abs=p=>path.resolve(p),work=abs(workArg||'tmp/ss-fs2-final-build');
const in1=abs(track1),in2=abs(track2),psBin=abs(psLatestBin),outBin=abs(outputBin),outCue=abs(outputCue),outReport=abs(reportPath);
if(new Set([in1,in2,psBin,outBin,outCue,outReport]).size!==6)throw new Error('inputs and outputs must be distinct');
for(const p of [in1,in2,psBin])if(!fs.existsSync(p))throw new Error(`missing input ${p}`);
fs.mkdirSync(work,{recursive:true});fs.mkdirSync(path.dirname(outBin),{recursive:true});
const stageA=path.join(work,'stage-a.bin'),stageB=path.join(work,'stage-b.bin'),latestDat=path.join(work,'latest-ps1-FS2_FILE.DAT');
const run=(label,command,args)=>{console.log(`\n[${label}] ${command} ${args.join(' ')}`);const r=cp.spawnSync(command,args,{cwd:ROOT,stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${label} failed (${r.status})`)};
const sha256=p=>{const h=crypto.createHash('sha256'),fd=fs.openSync(p,'r'),b=Buffer.alloc(1024*1024);try{for(;;){let n=fs.readSync(fd,b,0,b.length,null);if(!n)break;h.update(b.subarray(0,n))}}finally{fs.closeSync(fd)}return h.digest('hex').toUpperCase()};
const relFrom=(base,target)=>path.relative(base,target).replace(/\\/g,'/');

console.log('[inputs]');console.log(`SS Track 1 SHA-256 ${sha256(in1)}`);console.log(`SS Track 2 SHA-256 ${sha256(in2)}`);console.log(`PS1 latest SHA-256 ${sha256(psBin)}`);
run('extract latest PS1 DAT','node',['scripts/extract-dat-from-raw-bin.js',psBin,latestDat,'--lba','223','--bytes','244678656']);

const manifestPath=path.join(work,'safe-manifest.json'),preflightPath=path.join(work,'translation-preflight.json');
run('refresh dialogue classification','node',['scripts/ss-fs2-prepare-translation-build.js',in1,in2,'ps1/SLPS-01903/FS2_FILE.DAT','ps1/SLPS-01903/SLPS_019.03','trDatas/dialogue-workflow/dialogue-translation.tsv','tmp/SLPS-01903/dialogue-workflow/apply',manifestPath,preflightPath]);
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
manifest.input={track1:in1,track2:in2,track1Sha256:sha256(in1),track2Sha256:sha256(in2)};
manifest.output={track1:stageA,cue:path.join(work,'safe.cue'),report:path.join(work,'safe.report.json')};
fs.writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,'utf8');
run('safe dialogue','node',['scripts/ss-fs2-build-message-patch.js',manifestPath,'--force','--summary']);
run('reveal overflow','node',['scripts/ss-fs2-reveal-extension-poc.js',stageA,stageB,'--overflow-preflight',preflightPath,'tmp/SLPS-01903/dialogue-workflow/apply']);
run('finale','node',['scripts/ss-fs2-reveal-extension-poc.js',stageB,stageA,'--finale-map','output/ss-fs2-finale-map.json','tmp/SLPS-01903/dialogue-workflow/apply']);

const uiMap=path.join(work,'ui-map.json');run('map 1bpp UI','node',['scripts/ss-fs2-map-ui-masks.js',in1,'ps1/SLPS-01903/FS2_FILE.DAT','ps1/SLPS-01903/SLPS_019.03',uiMap,'trDatas/ui-mask-workflow/item_830_1008.tsv','trDatas/ui-mask-workflow/menu_1009_1080.tsv','trDatas/ui-mask-workflow/unit_help_1081_1147.tsv','trDatas/ui-mask-workflow/day_1151_1168.tsv']);
run('safe 1bpp UI','node',['scripts/ss-fs2-build-ui-mask-patch.js',stageA,stageB,uiMap,'tmp/SLPS-01903/ui-mask-workflow/apply',path.join(work,'ui-safe.report.json')]);

const namesDat=path.join(work,'names-patched.dat');run('build PS1 name resources','python',['scripts/name-table-tool.py','patch','ps1/SLPS-01903/FS2_FILE.DAT','ps1/SLPS-01903/SLPS_019.03','trDatas/name-table-workflow/name-table.tsv',namesDat]);
run('name tables','node',['scripts/ss-fs2-build-name-table-patch.js',stageB,stageA,'ps1/SLPS-01903/FS2_FILE.DAT',namesDat,'ps1/SLPS-01903/SLPS_019.03','trDatas/name-table-workflow/name-table.tsv',path.join(work,'names.report.json')]);

const beMap=path.join(work,'behdr-map.json');run('map 8bpp UI','node',['scripts/ss-fs2-map-behdr-ui.js',in1,'ps1/SLPS-01903/FS2_FILE.DAT','ps1/SLPS-01903/SLPS_019.03','trDatas/be-hdr-ui-workflow/be-hdr-ui-translation.tsv',beMap]);
run('safe 8bpp UI','node',['scripts/ss-fs2-build-behdr-ui-patch.js',stageA,stageB,'ps1/SLPS-01903/FS2_FILE.DAT',latestDat,'ps1/SLPS-01903/SLPS_019.03',beMap,path.join(work,'behdr.report.json')]);
run('title logos','node',['scripts/ss-fs2-build-logo-patch.js',stageB,stageA,'ps1/SLPS-01903/FS2_FILE.DAT',latestDat,'ps1/SLPS-01903/SLPS_019.03',path.join(work,'logo.report.json')]);
run('speaker names','node',['scripts/ss-fs2-build-speaker-name-patch.js',stageA,stageB,'ps1/SLPS-01903/FS2_FILE.DAT',latestDat,'ps1/SLPS-01903/SLPS_019.03',path.join(work,'speakers.report.json')]);
run('platform-difference 1bpp UI','node',['scripts/ss-fs2-build-ui-mask-exceptions.js',stageB,stageA,'tmp/SLPS-01903/ui-mask-workflow/apply/ui-mask-930-ko.pbm','tmp/SLPS-01903/ui-mask-workflow/apply/ui-mask-1053-ko.pbm',path.join(work,'ui-extra.report.json')]);

const custom1018=path.join(work,'message-mask-1018-ko.pgm');run('render SS message 1018','powershell',['-ExecutionPolicy','Bypass','-File','scripts/render-text-to-message-pgm.ps1','-FontPath','font/gulim.ttc','-Text','방향키의 좌우 또는\\nL, R버튼으로 선택해서\\nC버튼으로 결정하면돼.','-OutPath',custom1018,'-FontSize','12','-X','0','-Y','0','-LineHeight','15','-Pad','2','-InkMax','2','-Threshold','32','-BrightThreshold','96','-Bold','0','-Shadow','1','-ShadowX','1','-ShadowY','1','-ShadowInk','1','-Mode','AntiAlias','-TrimToOrigin']);
run('platform-difference dialogue','node',['scripts/ss-fs2-reveal-extension-poc.js',stageA,outBin,'1018',custom1018,'5040','tmp/SLPS-01903/dialogue-workflow/apply/message-mask-5040-ko.pgm','5042','tmp/SLPS-01903/dialogue-workflow/apply/message-mask-5042-ko.pgm','6093','tmp/SLPS-01903/dialogue-workflow/apply/message-mask-6093-ko.pgm']);
run('final Mode 1 verification','node',['scripts/ss-fs2-verify-patched-bin.js',in1,outBin]);

const cueDir=path.dirname(outCue),cue=`FILE "${relFrom(cueDir,outBin)}" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\nFILE "${relFrom(cueDir,in2)}" BINARY\n  TRACK 02 AUDIO\n    INDEX 00 00:00:00\n    INDEX 01 00:02:00\n`;fs.mkdirSync(cueDir,{recursive:true});fs.writeFileSync(outCue,cue,'ascii');
const preflight=JSON.parse(fs.readFileSync(preflightPath,'utf8'));
const revealOverflow=preflight.rejectedEntries.filter(x=>x.category==='reveal-overflow').length;
const report={version:1,createdAt:new Date().toISOString(),inputs:{track1:in1,track1Sha256:sha256(in1),track2:in2,track2Sha256:sha256(in2),psLatestBin:psBin,psLatestBinSha256:sha256(psBin)},output:{bin:outBin,cue:outCue,sha256:sha256(outBin),bytes:fs.statSync(outBin).size},applied:{safeDialogue:preflight.ready,revealOverflow,finale:220,ui1bppSafe:334,ui1bppPlatformDifference:2,nameEntries:420,ui8bppSafe:54,titleLogos:2,speakerNames:25,platformDialogue:4},deferred:{paletteLayerUi:[714,1073,1074,1087,1088]}};fs.writeFileSync(outReport,JSON.stringify(report,null,2));console.log(`\n[complete] ${outBin}`);console.log(`SHA-256 ${report.output.sha256}`);console.log(`CUE ${outCue}`);console.log(`report ${outReport}`);
