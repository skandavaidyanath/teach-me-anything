/**
 * Wraps model-written figure code into a document for a sandboxed frame.
 *
 * The prelude gives the code `window.tma`: the current state, a frame clock
 * the lesson can pause, highlight delivery, and click reporting. Nothing else
 * is reachable. The frame has an opaque origin and a content security policy
 * that allows inline script and style and nothing from the network.
 */

export const COMPONENT_THEME_CSS = `:root{--ink:#17243a;--ink-soft:#4b5a73;--ink-mute:#8a97aa;--surface:#ffffff;--board:#eaeef3;--line:#c9d2dd;--marker:#f6c84f;--marker-soft:#fdeeb9;--correct:#1f9c79;--correct-soft:#d6f1e8;--incorrect:#c3573f;--incorrect-soft:#f6ddd6;--font:"Atkinson Hyperlegible",system-ui,sans-serif}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:var(--ink);font-family:var(--font)}
*{box-sizing:border-box}
[data-tma-highlight="marker"]{filter:drop-shadow(0 0 2px var(--marker)) drop-shadow(0 0 9px var(--marker))}
[data-tma-highlight="correct"]{filter:drop-shadow(0 0 2px var(--correct)) drop-shadow(0 0 9px var(--correct))}
[data-tma-highlight="incorrect"]{filter:drop-shadow(0 0 2px var(--incorrect)) drop-shadow(0 0 9px var(--incorrect))}`;

const PRELUDE = `(function(){
var state=__STATE__;var ls={state:[],frame:[],highlight:[]};var running=true;var last=null;var elapsed=0;
function post(type,data){parent.postMessage({tma:true,type:type,data:data||{}},"*");}
function report(e){post("error",{message:e&&e.message?e.message:String(e)});}
function applyHighlight(ids,tone){
  var all=document.querySelectorAll("[data-tma-highlight]");
  for(var i=0;i<all.length;i++)all[i].removeAttribute("data-tma-highlight");
  for(var j=0;j<ids.length;j++){var el=document.getElementById(ids[j]);if(el)el.setAttribute("data-tma-highlight",tone||"marker");}
  for(var k=0;k<ls.highlight.length;k++){try{ls.highlight[k](ids,tone||"marker");}catch(e){report(e);}}
}
var api={
  get state(){return state;},
  get running(){return running;},
  onState:function(cb){ls.state.push(cb);try{cb(state,null);}catch(e){report(e);}},
  onFrame:function(cb){ls.frame.push(cb);},
  onHighlight:function(cb){ls.highlight.push(cb);},
  emit:function(type,data){post("custom",{type:type,data:data});}
};
Object.defineProperty(window,"tma",{value:api,writable:false});
function tick(now){
  if(running){var dt=last===null?0:(now-last)/1000;if(dt>0.1)dt=0.1;elapsed+=dt;
    for(var i=0;i<ls.frame.length;i++){try{ls.frame[i](elapsed,dt);}catch(e){report(e);ls.frame.splice(i,1);i--;}}}
  last=now;requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
window.addEventListener("message",function(ev){var m=ev.data;if(!m||!m.tma)return;
  if(m.type==="state"){var prev=state;state=Object.assign({},state,m.state||{});for(var i=0;i<ls.state.length;i++){try{ls.state[i](state,prev);}catch(e){report(e);}}}
  else if(m.type==="highlight"){applyHighlight(m.ids||[],m.tone);}
  else if(m.type==="clock"){running=!!m.running;}
});
document.addEventListener("click",function(ev){var el=ev.target;
  while(el&&el!==document.body&&el!==document.documentElement){if(el.id){post("click",{target:el.id});return;}el=el.parentNode;}
  post("click",{target:null});
});
window.addEventListener("error",function(ev){post("error",{message:ev.message||"error"});});
window.addEventListener("unhandledrejection",function(ev){post("error",{message:String(ev.reason)});});
window.addEventListener("load",function(){post("ready",{});});
})();`;

/** Models sometimes hand back a whole page. Keep what goes in the body. */
export function stripDocumentWrapper(code: string): string {
  let c = code.trim();
  c = c.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "");
  c = c.replace(/<!doctype[^>]*>/gi, "");
  c = c.replace(/<\/?html[^>]*>/gi, "");
  c = c.replace(/<\/?head[^>]*>/gi, "");
  c = c.replace(/<\/?body[^>]*>/gi, "");
  c = c.replace(/<meta[^>]*>/gi, "");
  c = c.replace(/<title>[^<]*<\/title>/gi, "");
  return c.trim();
}

/** JSON that is safe inside a <script> element. */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value ?? {}).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function buildComponentDocument(code: string, state: Record<string, unknown>): string {
  const body = stripDocumentWrapper(code);
  const prelude = PRELUDE.replace("__STATE__", scriptSafeJson(state));
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'">`,
    `<style>${COMPONENT_THEME_CSS}</style>`,
    `<script>${prelude}</script>`,
    "</head><body>",
    body,
    "</body></html>",
  ].join("\n");
}
