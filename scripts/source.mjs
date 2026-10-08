// Include only source directories; never environment files, databases or runtime fixtures.
import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
mkdirSync('dist',{recursive:true});
execFileSync('tar',['-czf','dist/source.tar.gz','--exclude=generated','--exclude=__pycache__','apps','packages','vendor','migrations','scripts','tests','docker','LICENSE','THIRD_PARTY_NOTICES.md','README.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','eslint.config.mjs','vitest.config.ts','playwright.config.ts','Dockerfile','docker-compose.yml','.gitignore','.env.example','.dockerignore']);
