// Mobile layout and voice lifecycle: real audio/player/UI, fixture provider responses.
// BASE_URL=http://localhost:3002 node scripts/e2e-mobile.mjs
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL ?? 'http://localhost:3002';
const OUT = '/tmp/chalky-mobile';
mkdirSync(OUT,{recursive:true});
const ndjson = events => events.map(e=>JSON.stringify(e)).join('\n')+'\n';
const beat = (id,say,check,mode='talk') => ({id,say,check,mode,scene:1,at:'Light',visual:'A circle for the sun',adds:mode==='draw'?[{id:'sun',what:'Sun'}]:[],points:[],region:{x:20,y:20,w:60,h:60}});
for (const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
 if(process.env.ENGINE && process.env.ENGINE !== name) continue;
 const browser=await engine.launch({args:name==='chromium'?['--enable-unsafe-swiftshader']:[]});
 try {
  for (const [width,height] of [[320,568],[390,844],[412,915],[768,1024],[1024,768],[844,390],[1440,900]]) {
   if(process.env.WIDTH && Number(process.env.WIDTH) !== width) continue;
   const mobile=width<=1024;
   const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
   await context.addInitScript(()=>{
    const Native=window.AudioContext;
    window.__audioContexts=[];
    window.AudioContext=class extends Native { constructor(...args){super(...args);window.__audioContexts.push(this); const add=this.audioWorklet.addModule.bind(this.audioWorklet); this.audioWorklet.addModule=(...a)=>add(...a).catch(e=>{console.error('worklet module',e.name,e.message);throw e;});} };
    Object.defineProperty(MediaDevices.prototype, 'getUserMedia', { configurable:true, value:async()=>{
      const ctx=new Native(); return ctx.createMediaStreamDestination().stream;
    }});
   });
   const page=await context.newPage();
   let socket; const saves=[]; const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   if(process.env.DIAGNOSTICS) page.on('console',m=>console.log(name,m.type(),m.text().slice(0,250)));
   page.setDefaultTimeout(30000);
   await page.routeWebSocket('wss://api.cartesia.ai/**',ws=>{socket=ws;});
   await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(process.env.DIAGNOSTICS) console.log('route',path);
    if(path==='/api/fixture') return route.fulfill({contentType:'application/x-ndjson',body:ndjson([{type:'title',title:'Plants and sunlight',tMs:0},{type:'beat',beat:beat('b1','Light helps plants make sugar.',false,'draw'),tMs:0},{type:'beat',beat:beat('b2','What does the plant make?',true),tMs:0},{type:'done',tMs:0,inputTokens:0,outputTokens:0}])});
    if(path==='/api/tts') {
      const words=route.request().postDataJSON().text.split(/\s+/);
      return route.fulfill({contentType:'application/x-ndjson',body:ndjson([{type:'start',source:'sonic',sampleRate:24000,encoding:'pcm_s16le'},{type:'audio',seq:0,data:Buffer.alloc(48000).toString('base64'),bytes:48000,tMs:0},{type:'timestamps',words,start:words.map((_,i)=>i/words.length),end:words.map((_,i)=>(i+1)/words.length),tMs:0},{type:'done',tMs:1000,stats:{firstAudioMs:0,bytes:48000,audioSeconds:1}}])});
    }
    if(path==='/api/draw') return route.fulfill({json:{elements:[{id:'sun',kind:'circle',args:[50,45,12],text:'Sun',refs:'',at:0,dur:.3,color:'orange'}],ms:1,model:'fixture'}});
    if(path==='/api/cartesia/token') return route.fulfill({json:{token:'test',version:'2026-03-01',expiresAt:Date.now()+3600000}});
    if(path==='/api/cartesia/voices') return route.fulfill({json:{voices:[]}});
    if(path==='/api/live-log') saves.push(JSON.parse(route.request().postData()));
    return route.fulfill({json:{}});
   });
   await page.goto(`${BASE}/lesson?fixture=mobile-test&intake=0`);
   await page.getByRole('button',{name:'Start talking',exact:true}).waitFor();
   await page.evaluate(()=>document.fonts.ready);
   const tap=async locator=>mobile?locator.tap():locator.click();
   await tap(page.getByRole('button',{name:'Preferences',exact:true}));
   const dialog=page.locator('dialog[open]');
   await dialog.getByLabel('Teaching pace').selectOption('stepwise');
   assert.equal(await dialog.getByLabel('Teaching pace').inputValue(),'stepwise');
   const font=await dialog.getByLabel('Teaching pace').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
   if(mobile) assert.ok(font>=16,'mobile select should not trigger input zoom');
   await tap(page.getByRole('tab',{name:'Learning history'}));
   await page.getByText('A place for what you’re learning.').waitFor();
   await tap(page.getByRole('button',{name:'Close preferences'}));
   await tap(page.getByRole('button',{name:'Start talking',exact:true}));
   await page.waitForFunction(()=>document.querySelector('.tutor-board')?.dataset.status==='idle'&&document.querySelector('.tutor-board')?.dataset.mic==='open').catch(async error=>{
    console.log('START FAILURE',await page.locator('.tutor-board').getAttribute('data-status'),await page.locator('.tutor-board').getAttribute('data-mic'),await page.locator('body').innerText(),await page.evaluate(()=>window.__audioContexts.map(c=>({state:c.state,time:c.currentTime}))));
    await page.screenshot({path:`${OUT}/${name}-${width}-failure.png`}); throw error;
   });
   socket.send(JSON.stringify({type:'turn.start'}));
   socket.send(JSON.stringify({type:'turn.update',transcript:'Explain photosynthesis'}));
   socket.send(JSON.stringify({type:'turn.end',transcript:'Explain photosynthesis'}));
   await page.waitForFunction(()=>document.querySelector('.tutor-board')?.dataset.status==='waiting',null,{timeout:30000});
   await page.locator('.pen').waitFor({timeout:15000}).catch(async error=>{console.log('DRAW FAILURE',errors,saves.at(-1)?.events?.filter(e=>/error|draw|compiled/.test(e.kind)));await page.screenshot({path:`${OUT}/${name}-${width}-draw-failure.png`});throw error;});
   const rects=await page.evaluate(()=>{
    const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
    return {board:rect('.stage .visual'),dock:rect('.conversation-dock'),pen:rect('.pen'),brand:rect('.chalky-wordmark'),gear:rect('.preferences-gear'),overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(rects.overflow,false,`${name} ${width} horizontal overflow`);
   for(const [key,r] of Object.entries(rects).filter(([,v])=>typeof v==='object')) assert.ok(r.w>0&&r.h>0&&r.x>=-1&&r.y>=-1&&r.right<=width+1&&r.bottom<=height+1,`${name} ${width} ${key} out of view ${JSON.stringify(r)}`);
   assert.ok(rects.board.bottom<=rects.dock.y+1||rects.board.right<=rects.dock.x+1,`${name} ${width}: board overlaps caption`);
   assert.ok(rects.pen.y>=rects.brand.bottom||rects.pen.x>=rects.brand.right,`${name} ${width}: toolbar overlaps logo`);
   await tap(page.getByRole('button',{name:'Mute',exact:true}));
   await page.getByRole('button',{name:'Unmute',exact:true}).waitFor();
   await tap(page.getByRole('button',{name:'Unmute',exact:true}));
   // Simulate an OS interruption, recover through a real user tap.
   await page.evaluate(async()=>{await Promise.all(window.__audioContexts.map(ctx=>ctx.suspend()));});
   await tap(page.getByRole('button',{name:'Tap to resume audio'}));
   await page.waitForFunction(()=>window.__audioContexts.every(ctx=>ctx.state==='running'));
   // Switching apps saves without ending the lesson (the server still receives its full transcript).
   await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForTimeout(250);
   assert.equal(saves.at(-1)?.end,null,`${name} ${width}: backgrounding ended lesson`);
   assert.ok(saves.at(-1)?.beats.length>0,'full transcript goes to existing Convex mirror route');
   await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
   await page.screenshot({path:`${OUT}/${name}-${width}x${height}-lesson.png`});
   await tap(page.getByRole('button',{name:'Finish lesson',exact:true}));
   await page.getByRole('heading',{name:'A good place to pause.'}).waitFor();
   await page.getByText('Your session is saved in Settings → Learning history.').waitFor();
   await dialog.getByLabel('One last thought, if you like').fill('Plants use light to make sugar.');
   await tap(dialog.getByRole('button',{name:'Save reflection'}));
   await dialog.getByText('Reflection saved.').waitFor();
   await page.screenshot({path:`${OUT}/${name}-${width}x${height}-ending.png`});
   assert.deepEqual(errors,[],`${name} ${width} browser errors`);
   console.log(`PASS ${name} ${width}x${height}: voice, mute, audio recovery, background save, settings, ending and layout`);
   await context.close();
  }
 } finally {await browser.close();}
}
