import {createHash} from 'node:crypto';
import {parse as upstreamParse,uri,shadowrocket} from './generated/upstream.mjs';
import {configSchema,envelopeSchema,type Envelope,type NormalizedNode,type Json} from '../shared/schema';
const version='a3e61061e50b40e5c5938969aab915d05d8d7069' as const;
const ownedKeys=new Set('encryption flow security sni peer fp pbk sid spx type network headerType host path serviceName mode alpn allowInsecure insecure allow_insecure packetEncoding packet-encoding aid scy cipher obfs obfs-password obfs_password up down upmbps downmbps mport ports hop-interval congestion_control congestion-controller udp_relay_mode udp-relay-mode disable_sni reduce_rtt fast_open heartbeat udp tfo plugin ech pqv extra finalmask pcs vcn'.split(' ').map(k=>k.toLowerCase()));
const vmessOwned=new Set('v ps add port id aid scy net type host path tls sni alpn fp insecure allowInsecure'.split(' '));
const decode=(v:string)=>decodeURIComponent(v.replace(/\+/g,' '));
export function queryEntries(text:string){
 const fragment=text.split('#')[0];const q=fragment.indexOf('?');
 if(q<0)return [];
 return fragment.slice(q+1).split('&').filter(Boolean).map(part=>{const p=part.indexOf('=');const rawKey=p<0?part:part.slice(0,p);const rawValue=p<0?'':part.slice(p+1);return {rawKey,rawValue,decodedKey:decode(rawKey),decodedValue:decode(rawValue),hasEquals:p>=0,owned:ownedKeys.has(decode(rawKey).toLowerCase())};});
}
export function parseNode(input:string):Envelope {
 const original_uri=input.trim();
 if(!/^(vless|vmess|trojan|ss|hysteria2|hy2|tuic):\/\//.test(original_uri)||original_uri.length>20000)throw new Error('不支持的协议或链接过长');
 try {
  const result=upstreamParse(original_uri);
  const normalized_config=configSchema.parse(JSON.parse(JSON.stringify(result.config)));
  const query=queryEntries(original_uri);
  const vmessExtra:Record<string,Json>={};
  if(normalized_config.type==='vmess'){
   try{const obj=JSON.parse(Buffer.from(original_uri.slice(8).split('#')[0],'base64').toString('utf8')) as Record<string,Json>;
    for(const [k,v] of Object.entries(obj))if(!vmessOwned.has(k))vmessExtra[k]=v;
   }catch{/* alternate VMess URI uses query sidecar */}
  }
  // A private key normalized by upstream remains sidecar-owned, not an application editable field.
  const generatedKeys=new Set(queryEntries(uri(normalized_config)).map(e=>e.decodedKey));
  for(const entry of query)if(generatedKeys.has(entry.decodedKey)&&!ownedKeys.has(entry.decodedKey.toLowerCase()))entry.owned=false;
  const unsupported_fields=[...new Set(query.filter(e=>!e.owned).map(e=>e.decodedKey)),...Object.keys(vmessExtra)];
  const duplicates=query.filter((e,i)=>query.findIndex(x=>x.decodedKey===e.decodedKey)!==i);
  const parse_warnings=[...result.warnings];
  if(unsupported_fields.length)parse_warnings.push('含私有/未知字段：保留原始编码，并通过 URI 订阅分发');
  if(duplicates.length)parse_warnings.push('含重复 query：未知参数按原顺序完整保留；已知参数按当前结构化配置输出');
  const envelope=envelopeSchema.parse({original_uri,normalized_config,unknown_params:{query,vmessExtra},parser_name:'Sub-Store',parser_version:version,parse_warnings,unsupported_fields});
  generateURI(envelope);
  return envelope;
 }catch{throw new Error('链接解析失败：请检查协议、地址、端口、凭据和编码');}
}
export function generateURI(node:Envelope):string{
 const config=configSchema.parse(node.normalized_config);
 let generated=uri(structuredClone(config));
 if(!generated)throw new Error('当前配置不能生成有效链接');
 if(config.type==='vmess'&&generated.startsWith('vmess://')){
  const current=JSON.parse(Buffer.from(generated.slice(8),'base64').toString('utf8')) as Record<string,Json>;
  const merged={...node.unknown_params.vmessExtra,...current};
  return 'vmess://'+Buffer.from(JSON.stringify(merged)).toString('base64');
 }
 const [base,fragment='']=generated.split('#');
 const generatedEntries=queryEntries(generated);
 const extras=node.unknown_params.query.filter(e=>!e.owned&&!ownedKeys.has(e.decodedKey.toLowerCase()));
 const extraKeys=new Set(extras.map(e=>e.decodedKey));
 // Unknown normalized private fields must not duplicate/rename original spelling.
 const cleaned=generatedEntries.filter(e=>!extraKeys.has(e.decodedKey)&&!extraKeys.has(e.decodedKey.replace(/_/g,'-')));
 const head=base.split('?')[0];
 const query=[...cleaned.map(e=>`${e.rawKey}${e.hasEquals?'='+e.rawValue:''}`),...extras.map(e=>`${e.rawKey}${e.hasEquals?'='+e.rawValue:''}`)].join('&');
 generated=head+(query?'?'+query:'')+'#'+fragment;
 return generated;
}
export function generateV2RayLine(node:Envelope){return generateURI(node);}
export function generateShadowrocket(nodes:Envelope[]):{body:string;contentType:string;mode:string}{
 if(!nodes.length)return {body:'proxies: []\n',contentType:'text/yaml; charset=utf-8',mode:'yaml'};
 // Sub-Store's Shadowrocket YAML is lossy for unknown fields and complex XHTTP.
 if(nodes.some(n=>n.unsupported_fields.length||n.normalized_config.network==='xhttp'))return {body:Buffer.from(nodes.map(generateURI).join('\n')).toString('base64'),contentType:'text/plain; charset=utf-8',mode:'uri-fallback'};
 const body=shadowrocket(nodes.map(n=>configSchema.parse(n.normalized_config)));
 return {body,contentType:'text/yaml; charset=utf-8',mode:'sub-store-shadowrocket'};
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function fingerprints(e:Envelope){return {raw:hash(e.original_uri),semantic:hash(JSON.stringify({config:e.normalized_config,unknown:e.unknown_params.query.filter(q=>!q.owned),vmess:e.unknown_params.vmessExtra}))};}
export function preview(text:string,existing:Envelope[]=[]){
 return text.split(/\r?\n/).map((line,index)=>({line:line.trim(),index})).filter(x=>x.line).map(({line,index})=>{
  try{const envelope=parseNode(line),fp=fingerprints(envelope);const duplicate=existing.some(e=>{const p=fingerprints(e);return p.raw===fp.raw||p.semantic===fp.semantic;});return {index,status:duplicate||envelope.parse_warnings.length?'warning':'success',envelope,duplicate,error:null};}
  catch{return {index,status:'failure',envelope:null,duplicate:false,error:'无法解析此行，请检查格式和必需参数'};}
 });
}
export function editConfig(node:Envelope,config:NormalizedNode){return envelopeSchema.parse({...node,normalized_config:configSchema.parse(config)});}
