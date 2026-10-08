import {build} from 'esbuild';
import path from 'node:path';
await build({entryPoints:['packages/proxy-adapter/upstream-entry.js'],outfile:'packages/proxy-adapter/generated/upstream.mjs',bundle:true,platform:'node',format:'esm',packages:'external',minify:false,
 alias:{'@/core/app':path.resolve('packages/proxy-adapter/runtime.js'),'@':path.resolve('vendor/sub-store/src')},logLevel:'warning'});
