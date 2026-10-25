import { mkdirSync, writeFileSync } from 'node:fs';
import { BLOCKS as BASE_BLOCKS } from '../lib/blocks';
import { FOREST_ICONS } from './forest-icons';
const BLOCKS = [...BASE_BLOCKS, ...FOREST_ICONS];
import type { Shape } from '../presets/types';
const root='public/style-packs';
const revision = 'forest-v4';
const styles=[
 {id:'ink-watercolor',name:'Ink + watercolor',description:'Priority: loose black ink contours and pooled painted fills, inspired by the green chair.',ink:'#24251f',paper:'#f4f2ec',accent:'#318845',width:1.65,wobble:1.0,texture:0.3,mode:'paint'},
 {id:'editorial-doodle',name:'Editorial doodle',description:'Fine expressive ink and open space, with the shared teaching palette.',ink:'#292725',paper:'#fffdf8',accent:'#dc79ab',width:0.85,wobble:0.45,texture:0.10,mode:'spot'},
 {id:'monochrome-line',name:'Minimal ink line',description:'The desk reference’s sparse linework, retaining each object’s shared color.',ink:'#242420',paper:'#f6f5ed',accent:'#242420',width:0.9,wobble:0.3,texture:0,mode:'mono'},
 {id:'print-comic',name:'Print comic',description:'Comic contours and print texture, retaining the shared teaching palette.',ink:'#22251f',paper:'#f7f6ef',accent:'#387e42',width:1.3,wobble:0.65,texture:0.24,mode:'spot'},
 {id:'paper-cutout',name:'Paper cutout',description:'Bold colored silhouettes, minimal contour and grain. Existing curved geometry retained for comparison.',ink:'#302b24',paper:'#f7f5ef',accent:'#bd870b',width:0,wobble:0.45,texture:0.12,mode:'cutout'},
 {id:'chalk-sketch',name:'Chalk sketch',description:'Dry grainy marks and broken contours on warm paper.',ink:'#39362d',paper:'#f7f5ef',accent:'#a67d21',width:1.9,wobble:0.9,texture:0.5,mode:'chalk'},
 {id:'clean-diagram',name:'Clean diagram',description:'Precise paths and soft semantic colors with no texture.',ink:'#302b24',paper:'#f7f5ef',accent:'#b5831a',width:1.2,wobble:0,texture:0,mode:'clean'},
];
const palette:Record<string,string>={ink:'#302b24',green:'#46894b',blue:'#4f8ba8',red:'#b7684c',purple:'#9567a8',yellow:'#c69a34',orange:'#bb8144',brown:'#87644e',muted:'#8a8577',white:'#fffdf8'};
const mix=(a:string,b:string,t:number)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
mkdirSync(root,{recursive:true});
writeFileSync(`${root}/base-icons.json`,JSON.stringify({version:1,icons:BLOCKS},null,2));
const paper = '#f7f5ef';
const sharedPaint = (value:string|undefined):string|undefined => {
 if (!value) return undefined;
 if (value === 'board' || value === 'white') return paper;
 const base = palette[value.replace('-tint','')] ?? (/^#[a-f0-9]{6}$/i.test(value) ? value : palette.ink);
 return value.endsWith('-tint') ? mix(base,paper,.25) : base;
};
writeFileSync(`${root}/palette.json`,JSON.stringify({version:2,paper,colors:palette,tintMix:.25,rule:'Same part, same fill and stroke colors in every style. Texture only modulates luminance.'},null,2));
for(const sourceStyle of styles){
 const st = {...sourceStyle, texture:sourceStyle.texture * .35, paper, ink:palette.ink, accent:palette.yellow};
 const dir=`${root}/${st.id}`;mkdirSync(`${dir}/svg`,{recursive:true});
 const icons=BLOCKS.map(block=>({...block,parts:block.parts.map(part=>({...part,shapes:part.shapes.map(sh=>({...sh,stroke:sharedPaint(sh.stroke),fill:sharedPaint(sh.fill),width:(sh.width??1)*(st.mode==='cutout' ? (sh.fill ? 0 : 1.2) : st.width)}))}))}));
 writeFileSync(`${dir}/style.json`,JSON.stringify({version:2,...st,palette:'../palette.json',rendering:{engine:'svg',seed:17,notes:'Texture and wobble are SVG filters. Clayzo needs a renderer adapter for these effects; geometry, parts and anchors remain compatible.'}},null,2));
 writeFileSync(`${dir}/icons.json`,JSON.stringify({version:2,style:st.id,palette:'../palette.json',icons},null,2));
 for(const block of icons){
  const shape=(s:Shape)=>{
   const common=`fill="${s.fill??'none'}" stroke="${s.stroke??'none'}" stroke-width="${s.width??st.width}" stroke-linecap="round" stroke-linejoin="round"`;
   if(s.type==='path')return `<path d="${esc(s.d)}" ${common}/>`;
   if(s.type==='ellipse')return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" ${common}/>`;
   return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r??0}" ${common}/>`;
  };
  const filters=`<defs><filter id="hand" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".07" numOctaves="3" seed="17" result="warp"/><feDisplacementMap in="SourceGraphic" in2="warp" scale="${st.wobble}" xChannelSelector="R" yChannelSelector="G" result="rough"/><feTurbulence type="fractalNoise" baseFrequency="${st.mode==='paint'?'.16':'.65'}" numOctaves="3" seed="23" result="grain"/><feColorMatrix in="grain" type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="${st.texture}" intercept="${1-st.texture}"/><feFuncG type="linear" slope="${st.texture}" intercept="${1-st.texture}"/><feFuncB type="linear" slope="${st.texture}" intercept="${1-st.texture}"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer><feComposite in2="rough" operator="in" result="masked"/><feBlend in="rough" in2="masked" mode="multiply"/></filter></defs>`;
  writeFileSync(`${dir}/svg/${block.id}.svg`,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 ${block.size[0]+16} ${block.size[1]+16}" role="img" aria-label="${esc(block.title)}">${filters}<g${st.texture||st.wobble?' filter="url(#hand)"':''}>${block.parts.map(p=>`<g id="${esc(p.id)}">${p.shapes.map(shape).join('')}</g>`).join('')}</g></svg>`);
 }
}
writeFileSync(`${root}/manifest.json`,JSON.stringify({version:2,palette:'palette.json',preferred:'ink-watercolor',iconCount:BLOCKS.length,styles:styles.map(s=>({id:s.id,name:s.name,style:`${s.id}/style.json`,icons:`${s.id}/icons.json`}))},null,2));
const cards=(id:string)=>BLOCKS.map(b=>`<article><img src="${id}/svg/${b.id}.svg?v=${revision}" alt="${esc(b.title)}"><h3>${b.title}</h3><a href="${id}/svg/${b.id}.svg?v=${revision}" download>SVG</a></article>`).join('');
writeFileSync(`${root}/index.html`,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chalky style library</title><style>@font-face{font-family:Serif;src:url('/fonts/InstrumentSerif-Regular.ttf')}@font-face{font-family:Sans;src:url('/fonts/InstrumentSans-Regular.ttf')}*{box-sizing:border-box}body{margin:0;background:#f7f5ef;color:#302b24;font:15px Sans,system-ui}header{padding:48px 5% 26px}h1{font:54px Serif,Georgia;margin:0 0 12px}p{color:#766e60;max-width:780px;line-height:1.6}nav{position:sticky;top:0;background:#f7f5eff5;padding:16px 5%;display:flex;gap:10px;flex-wrap:wrap;z-index:2;border-bottom:1px solid #ded7c8}a{color:#6b552d}nav a{border:1px solid #d4cabb;border-radius:22px;padding:8px 12px;text-decoration:none}section{padding:36px 5%;scroll-margin-top:95px}h2{font:36px Serif,Georgia;margin:0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:18px;margin-top:25px}article{background:#ffffff65;border:1px solid #302b2412;border-radius:14px;padding:20px;text-align:center}article img{width:100%;height:135px}h3{font-size:14px;font-weight:400}article a{font-size:12px}.tag{font:12px Sans;background:#e8e2ba;padding:6px 10px;border-radius:20px;vertical-align:middle}footer{padding:40px 5%;color:#766e60}</style><header><h1>One shared palette. Seven visual styles.</h1><p>Every existing teaching icon, rendered from the same geometry and named parts. Start with ink + watercolor, then compare the other references. Color edition 3: every style uses the same colored parts, the same fills, and the same palette. Only linework and light texture vary.</p><a href="palette.json" download>Shared palette JSON</a> · <a href="base-icons.json" download>Base geometry JSON</a> · <a href="manifest.json" download>Pack manifest</a></header><nav>${styles.map(s=>`<a href="#${s.id}">${s.name}</a>`).join('')}</nav>${styles.map((s,i)=>`<section id="${s.id}" style="background:${paper}"><h2>${s.name} ${i===0?'<span class="tag">PRIMARY DIRECTION</span>':''}</h2><p>${s.description}</p><a href="${s.id}/style.json" download>Style JSON</a> · <a href="${s.id}/icons.json" download>Complete icon pack JSON</a><div class="grid">${cards(s.id)}</div></section>`).join('')}<footer>SVG texture filters are preview renderer effects. The live Clayzo lesson renderer has not been switched. Paper-cut geometry is a first pass using the existing curved paths.</footer>`);
writeFileSync(`${root}/README.md`,'# Chalky style packs\n\nRegenerate with `npx tsx scripts/build-style-packs.ts`.\n\nEach style has style.json, icons.json and one SVG per existing block. Base geometry, named parts, anchors and teaching meaning are preserved. All packs use palette.json with identical per-part fill and stroke values. The chair reference is the priority. SVG filters implement deterministic grain and contour wobble in the exported icons. These are style studies; changing live Clayzo rendering requires an adapter. The paper-cut preset retains curved source geometry and is not yet fully angular.\n');
console.log(`${styles.length} styles × ${BLOCKS.length} icons = ${styles.length*BLOCKS.length} SVGs`);
