// Copies the audited dependency closure; never changes upstream.
import {cpSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root = process.env.SUB_STORE_SOURCE || '/root/subscription-system-audit/repos/Sub-Store';
const expected='a3e61061e50b40e5c5938969aab915d05d8d7069';
if(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==expected) throw new Error('Unpinned Sub-Store source');
const files=['core/proxy-utils/parsers','core/proxy-utils/preprocessors','core/proxy-utils/producers/uri.js','core/proxy-utils/producers/shadowrocket.js','core/proxy-utils/producers/utils.js','core/proxy-utils/transport-path.js','core/proxy-utils/xhttp-utils.js','core/proxy-utils/ech-utils.js','core/proxy-utils/vmess-security.js','utils/index.js','utils/yaml.js'];
for(const f of files){const dest=path.join('vendor/sub-store/src',f);mkdirSync(path.dirname(dest),{recursive:true});cpSync(path.join(root,'backend/src',f),dest,{recursive:true});}
cpSync(path.join(root,'LICENSE'),'vendor/sub-store/LICENSE');
writeFileSync('vendor/sub-store/provenance.json',JSON.stringify({repository:'https://github.com/sub-store-org/Sub-Store',commit:expected,files,modifications:'None. Runtime import is replaced at build time with a local silent diagnostic shim. Only URI parser entry points and selected producers are called.'},null,2)+'\n');
// Preserve upstream's finishing normalizer without its server/runtime closure.
const source=readFileSync(path.join(root,'backend/src/core/proxy-utils/index.js'),'utf8');
const start=source.indexOf('function lastParse(proxy)');
const end=source.indexOf('\nfunction ',start+10);
const pathStart=source.indexOf('function formatTransportPath(path)');
writeFileSync('vendor/sub-store/src/normalize.js',"// Derived from Sub-Store core/proxy-utils/index.js, audited commit. AGPL-3.0.\n// Adaptation: X509 fingerprint uses Node standard library; no local CA file access.\nimport { X509Certificate } from 'node:crypto';\nconst rs={generateFingerprint(pem){return new X509Certificate(pem).fingerprint256;}};\nimport { isValidPortNumber, numberToString, isIPv4, isIPv6 } from './utils/index.js';\nfunction isIP(ip){return isIPv4(ip)||isIPv6(ip);}\nimport { normalizeWireGuardInterface } from './core/proxy-utils/producers/utils.js';\nimport $ from '@/core/app';\n"+source.slice(pathStart,start)+source.slice(start,end===-1?undefined:end)+'\nexport {lastParse};\n');
