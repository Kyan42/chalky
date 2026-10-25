const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const cancelMode = process.argv.includes('--cancel-sketch');
const sketchMode = cancelMode || process.argv.includes('--slow-sketch');
const ndjson = events => events.map(JSON.stringify).join('\n')+'\n';
(async () => {
 const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader']});
 try {
 const page=await browser.newPage(); const drawn=[]; const spoken=[]; const compiled=[]; const converseBoards=[];
 page.on('console', msg=>{if(msg.text().startsWith('[board]')) compiled.push(msg.text());});
 await page.route('**/api/live-log',r=>r.fulfill({json:{ok:true}}));
 await page.route('**/api/tts',r=>{const text=r.request().postDataJSON().text;spoken.push(text);const words=text.split(/\s+/);const secs=text.startsWith('Sunlight')?10:0.3;const data=Buffer.alloc(24000*2*secs);return r.fulfill({contentType:'application/x-ndjson',body:ndjson([{type:'start',sampleRate:24000,encoding:'pcm_s16le'},{type:'timestamps',words,start:words.map((_,i)=>i*secs/words.length),end:words.map((_,i)=>(i+1)*secs/words.length)},{type:'audio',data:data.toString('base64')},{type:'done',tMs:0,stats:{firstAudioMs:0,firstTimestampsMs:0,chunks:1,bytes:data.length,audioSeconds:secs,order:['timestamps','audio']}}])});});
 await page.route('**/api/converse',r=>{
 const body=r.request().postDataJSON(); converseBoards.push(body.board);
 const sketch=sketchMode&&converseBoards.length===1?{visual:'A tree',adds:[{id:'tree',what:'tree'}],near:null,side:'right'}:null;
 return r.fulfill({contentType:'application/x-ndjson',body:ndjson([{type:'level',level:sketchMode?'answer':'detour'},{type:'sentence',text:'Let me draw that for you.'},{type:'trailer',trailer:{actions:[],lesson:null,amend:null,level:sketchMode?'answer':'detour',resume:'wait',cursor:[],check:null,planner_note:'Draw a tree',sketch}},{type:'done'}])});
 });
 await page.route('**/api/amend',r=>{const prefix=r.request().postDataJSON().prefix;return r.fulfill({contentType:'application/x-ndjson',body:ndjson([{type:'beat',beat:{id:prefix+'-tree',say:'Here is your tree.',at:'Here',visual:'A tree',mode:'draw',check:true,scene:2,region:{x:10,y:10,w:80,h:70},adds:[{id:'tree',what:'tree'}],points:[]}},{type:'done'}])});});
 await page.route('**/api/draw',async r=>{const beat=r.request().postDataJSON().beat;drawn.push(beat.id);if(beat.id.startsWith('answer-')) await new Promise(resolve=>setTimeout(resolve,6500));return r.fulfill({json:{elements:[{id:beat.adds[0]?.id||'shape',kind:'circle',at:0,dur:.2,color:'green',args:[40,40,15],text:'',refs:''}]}});});
 await page.goto('http://localhost:3000/lesson?fixture=why-is-the-sky-blue-paced&beats=2&intake=0');
 await page.locator('details').evaluate(e=>{e.hidden=false;e.open=true});
 await page.getByTestId('question').fill('Why is the sky blue?');await page.getByTestId('ask').click();
 await page.waitForFunction(()=>document.querySelector('.tutor-board')?.dataset.status==='speaking');
 await page.waitForTimeout(700);
 await page.getByTestId('question').fill('Switch topics and draw a tree');await page.getByTestId('ask').click();
 if(sketchMode){
 if(cancelMode){
 await page.waitForTimeout(1000);
 await page.getByTestId('question').fill('Forget the tree. Explain electricity instead.');await page.getByTestId('ask').click();
 }
 await page.waitForTimeout(8000);
 await page.getByTestId('question').fill('What did you draw?');await page.getByTestId('ask').click();
 await page.waitForTimeout(500);
 if(cancelMode) {assert.equal(converseBoards.length,3,'new request must run while old drawing is pending');assert(!converseBoards[2].some(e=>e.id==='tree'),'cancelled sketch must never overwrite the new topic');}
 else assert(converseBoards[1]?.some(e=>e.id==='tree'),'slow sketch must be visible to the next turn, not dropped after speech');
 } else {
 await page.waitForTimeout(4000);
 assert(drawn.some(id=>id.endsWith('-tree')),'drawing must be requested');
 assert(spoken.includes('Here is your tree.'),'new drawing beat must play instead of silently resuming original lesson');
 assert(compiled.some(s=>s.includes('-tree:')),'new drawing must be compiled onto the whiteboard');
 }
 console.log('PASS:',cancelMode?'new turn cancels pending sketch without stale board changes':sketchMode?'slow sketch remains visible after speech':'topic change inserts, speaks and renders requested drawing','(APIs mocked)');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
