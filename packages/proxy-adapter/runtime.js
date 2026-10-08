// Upstream diagnostics must never print a URI, UUID, password or token.
let diagnostics=[];
export function resetDiagnostics(){diagnostics=[];}
export function getDiagnostics(){return diagnostics;}
export default {env:{isNode:false},info(){},log(){},warn(){diagnostics.push('解析器提示：部分客户端兼容参数需要确认');},error(){diagnostics.push('解析器提示：存在不支持或无效参数');}};
