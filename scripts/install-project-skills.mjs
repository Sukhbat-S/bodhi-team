#!/usr/bin/env node
import {symlinkSync,existsSync,mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd();const apply=process.argv.includes('--apply');
const names=JSON.parse(readFileSync('configs/personal-skill-matrix.json','utf8')).skills.map(x=>x.name);
for(const name of names){const target=resolve(root,'.agents/skills',name);if(existsSync(target))throw Error(`Refusing to overwrite existing project skill: ${name}`);}
console.log(`${apply?'Installing':'Would install'} ${names.length} owner-neutral project skills. No global skill directory is changed.`);
if(apply){mkdirSync(resolve(root,'.agents/skills'),{recursive:true});for(const name of names)symlinkSync('../../templates/personal/skills/'+name,resolve(root,'.agents/skills',name),'dir');}
