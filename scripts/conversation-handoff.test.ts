import assert from 'node:assert/strict';
import { handoffQuestion } from '../lib/lesson/conversation-handoff';
const waiting = {resume:'wait', level:'answer', check:null} as const;
assert.equal(handoffQuestion(waiting, 'That can be a busy day.', true), 'Would you like to explore that a little more?');
assert.equal(handoffQuestion(waiting, 'Does that make sense?', true), null);
assert.ok(handoffQuestion(waiting, 'Why? Here is the explanation.', true));
assert.equal(handoffQuestion({...waiting,check:'Which part should we explore?'}, 'Here is the explanation.', true), 'Which part should we explore?');
for (const extra of [{end:'model'}, {lesson:{}}, {amend:{}}, {research:{}}, {delegate:'help'}, {quiz:{}}, {level:'replan'}, {level:'detour'}]) {
 assert.equal(handoffQuestion({...waiting,...extra} as any, 'One moment.', true), null);
}
assert.equal(handoffQuestion({...waiting,resume:'continue'}, 'Next comes the nucleus.', true), null);
assert.ok(handoffQuestion({...waiting,resume:'continue'}, 'Hello there.', false));
console.log('Conversation handoff regression checks passed');
