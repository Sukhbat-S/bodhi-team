#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {classifyReleasePath,ownerNeutralContentError,validatePersonalReleaseManifest} from './lib/release-contract.mjs';
const args=process.argv.slice(2);const index=args.indexOf('--output');if(index<0||!args[index+1])throw Error('Usage: npm run pack:release -- --output <new-directory>');
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Commit the reviewed distribution source before packing a release');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const prepared=files.map(path=>{const stat=lstatSync(path);const bytes=readFileSync(path);if(!stat.isFile()||classifyReleasePath(path)!=='shared'||ownerNeutralContentError(bytes))throw Error('Unreviewed release file: '+path);return{path,bytes,mode:stat.mode&511};});
const plan=JSON.parse(readFileSync('configs/personal-schema-plan.json','utf8'));
const manifest={contractVersion:2,schemaPlan:{id:plan.id,source:plan.source,target:plan.target,rollback:plan.rollback},releaseVersion:'v'+JSON.parse(readFileSync('package.json','utf8')).version,sourceCommit,sourceDirty:false,compatibility:{platforms:['darwin-arm64','darwin-x64','linux-x64','linux-arm64'],schemaFrom:0,schemaTo:plan.migrations.length},artifacts:prepared.map(f=>({path:f.path,sha256:sha(f.bytes)})),migrations:plan.migrations};
const errors=validatePersonalReleaseManifest(manifest);if(errors.length)throw Error(errors.join('\n'));
const out=resolve(args[index+1]);mkdirSync(out);for(const f of prepared){const path=resolve(out,f.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,f.bytes,{flag:'wx',mode:f.mode});}
mkdirSync(resolve(out,'.release'));const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');writeFileSync(resolve(out,'.release/manifest.json'),bytes,{flag:'wx'});
execFileSync(process.execPath,['scripts/verify-personal-release.mjs','--root',out,'--expected-manifest-sha256',sha(bytes)],{stdio:'inherit'});console.log('Manifest SHA-256: '+sha(bytes));
