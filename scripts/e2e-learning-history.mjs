// Deterministic UI integration: real player, persistence, ending and continuation; model/audio responses are fixtures.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE_URL ?? 'http://localhost:3002';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
const logs = [];
const drawModes = [];
const sampleRequests = [];
let finalCheck = true;
page.on('pageerror', e => errors.push(e.message));
const ndjson = events => events.map(e => JSON.stringify(e)).join('\n') + '\n';
const beat = (id, say, check, mode='talk') => ({ id, say, check, mode, scene:1, at: 'Light', visual:'A circle for the sun', adds: mode==='draw'?[{id:'sun',what:'Sun'}]:[], points:[], region:{x:20,y:20,w:60,h:60} });
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/fixture') return route.fulfill({ contentType:'application/x-ndjson', body:ndjson([
    {type:'title',title:'Plants and sunlight',tMs:0},
    {type:'beat',beat:beat('b1','Light helps plants make sugar.',false,'draw'),tMs:0},
    {type:'beat',beat:beat('b2',finalCheck ? 'What does the plant make?' : 'Sugar stores that energy.',finalCheck),tMs:0},
    {type:'done',tMs:0,inputTokens:0,outputTokens:0}
  ]) });
  if (path === '/api/tts') {
    const text = route.request().postDataJSON().text;
    const words = text.split(/\s+/);
    return route.fulfill({contentType:'application/x-ndjson', body:ndjson([
      {type:'start',source:'sonic',sampleRate:24000,encoding:'pcm_s16le'},
      {type:'audio',seq:0,data:Buffer.alloc(48000).toString('base64'),bytes:48000,tMs:0},
      {type:'timestamps',words,start:words.map((_,i)=>i/words.length),end:words.map((_,i)=>(i+1)/words.length),tMs:0},
      {type:'done',tMs:1000,stats:{firstAudioMs:0,bytes:48000,audioSeconds:1}}
    ]) });
  }
  if (path === '/api/draw') drawModes.push(route.request().postDataJSON().mode);
  if (path === '/api/voice-sample') {
    sampleRequests.push(route.request().postDataJSON());
    const wav = Buffer.alloc(2444);
    wav.write('RIFF'); wav.writeUInt32LE(2436,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(24000,24); wav.writeUInt32LE(48000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(2400,40);
    return route.fulfill({contentType:'audio/wav',body:wav});
  }
  if (path === '/api/draw') return route.fulfill({json:{elements:[{id:'sun',kind:'circle',args:[50,45,12],text:'Sun',refs:'',at:0,dur:0.3,color:'orange'}],ms:1,model:'fixture'}});
  if (path === '/api/live-log') logs.push(route.request().postDataJSON());
  if (path === '/api/cartesia/voices') return route.fulfill({json:{voices:[]}});
  return route.fulfill({json:{}});
});
try {
  await page.goto(`${BASE}/lesson?fixture=history-test&intake=0&debug=1`);
  await page.getByRole('button',{name:'Preferences',exact:true}).click();
  assert.equal(await page.locator('#lesson-voice option').count(),4);
  await page.getByLabel('Voice',{exact:true}).selectOption('b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1');
  await page.getByLabel('Speaking speed',{exact:true}).selectOption('1.2');
  await page.getByLabel('Drawing',{exact:true}).selectOption('slow');
  await page.getByLabel('Lesson language').selectOption('es');
  await page.getByLabel('Visual detail').selectOption('more');
  await page.getByLabel('Learning approach').selectOption('practice');
  await page.getByLabel('Teaching pace').selectOption('stepwise');
  assert.ok(sampleRequests.some(r=>r.voice==='b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1' && r.speed==='1.2'));
  await page.reload();
  await page.getByRole('button',{name:'Preferences',exact:true}).click();
  assert.equal(await page.getByLabel('Voice',{exact:true}).inputValue(),'b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1');
  assert.equal(await page.getByLabel('Speaking speed',{exact:true}).inputValue(),'1.2');
  assert.equal(await page.getByLabel('Drawing',{exact:true}).inputValue(),'slow');
  assert.equal(await page.getByLabel('Teaching pace').inputValue(),'stepwise');
  console.log('PASS curated voices, preview payloads and saved settings');
  await page.getByRole('tab',{name:'Learning history'}).click();
  await page.getByText('A place for what you’re learning.').waitFor();
  console.log('PASS empty history');
  await page.getByRole('button',{name:'Close preferences'}).click();
  await page.evaluate(async () => {
    const db = await new Promise((resolve,reject) => { const r=indexedDB.open('chalky-learning-history',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
    await new Promise((resolve,reject) => { const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put({id:'prior-session',topic:'Photosynthesis',startedAt:'2026-10-25T12:00:00Z',endedAt:'2026-10-25T12:05:00Z',status:'completed',covered:['Plants use light to make sugar.'],questions:[]});tx.oncomplete=resolve;tx.onerror=reject; });
    db.close();
  });
  await page.getByRole('button',{name:'Preferences',exact:true}).click();
  // Reopening settings mounts a fresh history only after switching tabs.
  await page.getByRole('tab',{name:'Preferences',exact:true}).click();
  await page.getByRole('tab',{name:'Learning history'}).click();
  await page.getByRole('button',{name:/Photosynthesis/}).click();
  await page.locator('dialog[open]').getByLabel('One last thought, if you like').fill('I mix up the gases.');
  await page.getByRole('button',{name:'More practice',exact:true}).click();
  await page.getByRole('button',{name:'Save reflection',exact:true}).click();
  await page.locator('dialog[open]').getByText('Reflection saved.').waitFor();
  await page.getByRole('button',{name:'Continue learning',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('.tutor-board')?.dataset.status === 'waiting', null, {timeout:45000});
  await page.getByRole('button',{name:'Finish lesson',exact:true}).click();
  await page.getByRole('heading',{name:'A good place to pause.'}).waitFor();
  await page.getByText('Your session is saved in Settings → Learning history.').waitFor();
  await page.getByText('Light helps plants make sugar.',{exact:true}).last().waitFor();
  const image=page.getByAltText('Saved whiteboard from Plants and sunlight');
  await image.waitFor();
  assert.ok((await image.getAttribute('src')).length > 3000);
  await page.screenshot({path:'/tmp/chalky-history-ending.png'});
  console.log('PASS explicit ending, recap, saved board');
  await page.locator('dialog[open]').getByLabel('One last thought, if you like').fill('Light provides energy.');
  await page.getByRole('button',{name:'It clicked',exact:true}).click();
  await page.getByRole('button',{name:'Save reflection',exact:true}).click();
  await page.locator('dialog[open]').getByText('Reflection saved.').waitFor();
  await page.reload();
  await page.getByRole('button',{name:'Preferences',exact:true}).click();
  await page.getByRole('tab',{name:'Learning history'}).click();
  await page.getByRole('button',{name:/Plants and sunlight/}).click();
  assert.equal(await page.locator('dialog[open]').getByLabel('One last thought, if you like').inputValue(),'Light provides energy.');
  assert.equal(await page.getByRole('button',{name:'It clicked',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByAltText('Saved whiteboard from Plants and sunlight').waitFor();
  await page.screenshot({path:'/tmp/chalky-history-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/chalky-history-mobile.png'});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log('PASS reload retains recap, reflection, confidence and board; mobile fits');
  finalCheck = false;
  await page.getByRole('button',{name:'Continue learning',exact:true}).click();
  await page.getByRole('heading',{name:'A good place to pause.'}).waitFor({timeout:45000});
  await page.getByText('Your session is saved in Settings → Learning history.').waitFor();
  assert.ok(logs.some(log => log.events?.some(event => event.kind === 'learner' && /Light provides energy/.test(event.text ?? ''))));
  console.log('PASS automatic completion and continuation carries saved reflection');
  assert.ok(drawModes.length > 0 && drawModes.every(mode => mode === 'slow'));
  console.log('PASS drawing preference reaches the drawing API');
  assert.deepEqual(errors,[]);
} finally { await browser.close(); }
