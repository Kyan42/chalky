// Run: node --conditions=react-server --import tsx --test scripts/tutor-turns.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTrailer, forcedLevel } from '../lib/lesson/converse';
import { isResume } from '../lib/lesson/resume';
const input = (utterance: string) => ({utterance, escalation: 1 as const, board: [], beats: [{id:'b1',say:'Plants use sunlight.',mode:'talk' as const}], beatIndex:0,wordIndex:-1});
test('acknowledgements and hesitation are evaluated rather than skipping the learner turn', () => {
  for (const text of ['yeah','um','okay','got it','kind of','I think so','not sure']) assert.equal(isResume(text),false,text);
  for (const text of ['continue','keep going','okay, go ahead']) assert.equal(isResume(text),true,text);
});
test('missing resume action waits and a spoken question overrides continue', () => {
  assert.equal(cleanTrailer({actions:[{type:'say'}]},input('why?'),'Light supplies energy.').resume,'wait');
  assert.equal(cleanTrailer({actions:[{type:'say'},{type:'resume',how:'continue'}]},input('I know sunlight'),'What do you think the plant uses it for?').resume,'wait');
});
test('hesitation cannot automatically advance and confusion does not force a drawing', () => {
  assert.equal(cleanTrailer({actions:[{type:'say'},{type:'resume',how:'continue'}]},input('kind of'),'Let’s try a smaller step.').resume,'wait');
  assert.equal(forcedLevel(input("I still don't understand")),null);
});
test('explicit continuation and drawing requests remain available', () => {
  assert.equal(cleanTrailer({actions:[{type:'say'},{type:'resume',how:'continue'}]},input('continue'),'Next, the leaf uses that energy.').resume,'continue');
  const result=cleanTrailer({actions:[{type:'say'}]},input('draw a leaf'),'Let me draw that.');
  assert.equal(result.level,'detour');
  assert.ok(result.amend);
});
