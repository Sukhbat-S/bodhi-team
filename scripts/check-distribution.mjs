#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync} from 'node:fs';
import {classifyReleasePath,ownerNeutralContentError} from './lib/release-contract.mjs';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{40,}/,/AKIA[0-9A-Z]{16}/,/sk-(?:proj-)?[A-Za-z0-9_-]{40,}/];
const failures=[];
for(const path of files){
 const stat=lstatSync(path); if(!stat.isFile()){failures.push(path+': not a regular file');continue;}
 if(classifyReleasePath(path)!=='shared'){failures.push(path+': outside reviewed distribution boundary');continue;}
 const bytes=readFileSync(path); if(ownerNeutralContentError(bytes))failures.push(path+': personal content');
 if(!bytes.includes(0)&&patterns.some(pattern=>pattern.test(bytes.toString('utf8'))))failures.push(path+': possible credential');
}
if(!files.length)failures.push('No tracked files to inspect');
for(const failure of failures)console.error(failure);
console.log(`Distribution boundary check: ${failures.length?'FAIL':'PASS'} (${files.length} tracked files)`);
console.log('Pattern checks supplement review; they are not a guarantee against every secret format.');
process.exitCode=failures.length?1:0;
