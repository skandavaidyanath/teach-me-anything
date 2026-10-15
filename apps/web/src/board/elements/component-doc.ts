/**
 * Wraps model-written figure code into a document for a sandboxed frame.
 *
 * The prelude gives the code `window.tma`: the current state, a frame clock
 * the lesson can pause, highlight delivery, and click reporting. Nothing else
 * is reachable. The frame has an opaque origin and a content security policy
 * that allows inline script and style and nothing from the network.
 */

/** Manim's palette, so a model that knows Manim's colours gets the same ones here. */
export const COMPONENT_PALETTE = { ink: "#ffffff", white: "#ffffff", soft: "#bbbbbb", mute: "#888888", blue: "#58c4dd", teal: "#5cd0b3", green: "#83c167", yellow: "#f7d96f", gold: "#f0ac5f", red: "#fc6255", maroon: "#c55f73", purple: "#9a72ac", pink: "#d147bd", orange: "#ff862f", surface: "#161a22", line: "#444444" } as const;

export const COMPONENT_THEME_CSS = `:root{--ink:#ffffff;--white:#ffffff;--ink-soft:#bbbbbb;--soft:#bbbbbb;--ink-mute:#888888;--mute:#888888;--surface:#161a22;--board:#0b0d12;--line:#444444;--marker:#f7d96f;--yellow:#f7d96f;--gold:#f0ac5f;--marker-soft:rgba(247,217,111,0.22);--correct:#83c167;--green:#83c167;--correct-soft:rgba(131,193,103,0.22);--incorrect:#fc6255;--red:#fc6255;--maroon:#c55f73;--incorrect-soft:rgba(252,98,85,0.22);--blue:#58c4dd;--teal:#5cd0b3;--purple:#9a72ac;--pink:#d147bd;--orange:#ff862f;--font:"Atkinson Hyperlegible",system-ui,sans-serif}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:var(--ink);font-family:var(--font)}
*{box-sizing:border-box}
@keyframes tma-pulse{from{opacity:.6}to{opacity:1}}
[data-tma-highlight="marker"]{filter:drop-shadow(0 0 3px var(--marker)) drop-shadow(0 0 12px var(--marker));animation:tma-pulse 900ms ease-in-out infinite alternate}
[data-tma-highlight="correct"]{filter:drop-shadow(0 0 3px var(--correct)) drop-shadow(0 0 12px var(--correct));animation:tma-pulse 900ms ease-in-out infinite alternate}
[data-tma-highlight="incorrect"]{filter:drop-shadow(0 0 3px var(--incorrect)) drop-shadow(0 0 12px var(--incorrect));animation:tma-pulse 900ms ease-in-out infinite alternate}`;

const PRELUDE = `(function(){
var state=__STATE__;var ls={state:[],frame:[],highlight:[]};var running=true;var last=null;var elapsed=0;var tweens=[];
var palette={ink:"#ffffff",white:"#ffffff",soft:"#bbbbbb",mute:"#888888",blue:"#58c4dd",teal:"#5cd0b3",green:"#83c167",yellow:"#f7d96f",gold:"#f0ac5f",red:"#fc6255",maroon:"#c55f73",purple:"#9a72ac",pink:"#d147bd",orange:"#ff862f",surface:"#161a22",line:"#444444"};
function sigmoid(x){return 1/(1+Math.exp(-x));}
function smooth(t){var inf=10,err=sigmoid(-inf/2);return Math.min(Math.max((sigmoid(inf*(t-0.5))-err)/(1-2*err),0),1);}
function rushInto(t){return 2*smooth(t/2);}
function rushFrom(t){return 2*smooth(t/2+0.5)-1;}
function thereAndBack(t){return smooth(t<0.5?2*t:2*(1-t));}
var easeInOut=smooth,easeOut=rushFrom;
function el(x){return typeof x==="string"?document.getElementById(x):x;}
function withBox(e){e.style.transformBox="fill-box";e.style.transformOrigin="center";}
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
  emit:function(type,data){post("custom",{type:type,data:data});},
  palette:palette,
  ease:{smooth:smooth,inOut:smooth,in:rushInto,out:rushFrom,thereAndBack:thereAndBack,linear:function(t){return t;}},
  lerp:function(a,b,t){return a+(b-a)*t;},
  tween:function(ms,fn,ease){return new Promise(function(resolve){tweens.push({t:0,ms:ms||600,fn:fn,ease:ease||smooth,resolve:resolve});});},
  create:function(x,ms){var e=el(x);if(!e)return Promise.resolve();var len=1;try{len=e.getTotalLength?e.getTotalLength():1;}catch(err){}if(!(len>0))len=1;
    e.style.strokeDasharray=len;e.style.strokeDashoffset=len;return api.tween(ms||800,function(p){e.style.strokeDashoffset=len*(1-p);}).then(function(){e.style.strokeDasharray="";e.style.strokeDashoffset="";});},
  write:function(x,ms){var e=el(x);if(!e)return Promise.resolve();e.style.clipPath="inset(0 100% 0 0)";return api.tween(ms||700,function(p){e.style.clipPath="inset(0 "+(100*(1-p))+"% 0 0)";}).then(function(){e.style.clipPath="";});},
  fadeIn:function(x,ms){var e=el(x);if(!e)return Promise.resolve();e.style.opacity=0;return api.tween(ms||500,function(p){e.style.opacity=p;});},
  fadeOut:function(x,ms){var e=el(x);if(!e)return Promise.resolve();return api.tween(ms||500,function(p){e.style.opacity=1-p;});},
  grow:function(x,ms){var e=el(x);if(!e)return Promise.resolve();withBox(e);e.style.transform="scale(0)";return api.tween(ms||500,function(p){e.style.transform="scale("+p+")";}).then(function(){e.style.transform="";});},
  indicate:function(x,ms,color){var e=el(x);if(!e)return Promise.resolve();withBox(e);var c=color||palette.yellow;return api.tween(ms||900,function(p){var k=thereAndBack(p);e.style.transform="scale("+(1+0.2*k)+")";e.style.filter=k>0.02?"drop-shadow(0 0 8px "+c+")":"";},function(t){return t;}).then(function(){e.style.transform="";e.style.filter="";});},
  flash:function(x,ms){return api.indicate(x,ms||450,palette.yellow);},
  circumscribe:function(x,ms,color){var e=el(x);if(!e||!e.getBBox||!e.ownerSVGElement)return Promise.resolve();var b=e.getBBox();var r=document.createElementNS("http://www.w3.org/2000/svg","rect");
    r.setAttribute("x",b.x-8);r.setAttribute("y",b.y-8);r.setAttribute("width",b.width+16);r.setAttribute("height",b.height+16);r.setAttribute("rx",6);r.setAttribute("fill","none");r.setAttribute("stroke",color||palette.yellow);r.setAttribute("stroke-width",3);
    e.ownerSVGElement.appendChild(r);var total=ms||1200;return api.create(r,total*0.45).then(function(){return api.tween(total*0.25,function(){});}).then(function(){return api.fadeOut(r,total*0.3);}).then(function(){r.remove();});},
  attr:function(x,to,ms){var e=el(x);if(!e)return Promise.resolve();var from={};for(var k in to){var v=parseFloat(e.getAttribute(k));from[k]=isNaN(v)?0:v;}
    return api.tween(ms||600,function(p){for(var k in to){e.setAttribute(k,from[k]+(to[k]-from[k])*p);}});},
  tone:function(freq,ms,opts){opts=opts||{};post("sound",{kind:"tone",freqs:[freq],ms:ms,wave:opts.wave,gain:opts.gain});},
  chord:function(freqs,ms,opts){opts=opts||{};post("sound",{kind:"chord",freqs:freqs,ms:ms,wave:opts.wave,gain:opts.gain});},
  click:function(){post("sound",{kind:"click"});},
  noise:function(ms,gain){post("sound",{kind:"noise",ms:ms,gain:gain});}
};
Object.defineProperty(window,"tma",{value:api,writable:false});
function tick(now){
  if(running){var dt=last===null?0:(now-last)/1000;if(dt>0.1)dt=0.1;elapsed+=dt;
    for(var j=0;j<tweens.length;j++){var tw=tweens[j];tw.t+=dt*1000;var p=Math.min(1,tw.t/tw.ms);try{tw.fn(tw.ease(p),p);}catch(e){report(e);p=1;}if(p>=1){tweens.splice(j,1);j--;tw.resolve();}}
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
