import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historyFromTranscript, continuationPrompt, isLessonEnding } from '../lib/learning-history';

test('history covers delivered content, never unplayed plans or interrupted beats', () => {
  const record = historyFromTranscript({ id: 'lesson-1234', question: 'Photosynthesis', title: 'Plants and sunlight', startedAt: '2026-10-25T12:00:00Z', endedAt: null, end: null,
    beats: [{ say: 'Plants use light to make sugar.', interrupted: false }, { say: 'Next we cover respiration.', interrupted: true }],
    events: [{ kind: 'planned', say: 'The entire Calvin cycle.' }, { kind: 'reply', text: 'Oxygen is released. What else do you remember?' }],
    learner: { confusions: ['Which gas goes in?'], replies: ['Sugar'] },
  });
  assert.deepEqual(record.covered, ['Plants use light to make sugar.', 'Oxygen is released.']);
  assert.equal(record.status, 'in-progress');
  assert.match(continuationPrompt({ ...record, reflection: 'I still mix up the gases.' }), /I still mix up the gases/);
  assert.doesNotMatch(continuationPrompt(record), /Calvin|respiration/);
});

test('ending requires an explicit finish request, not a quiz answer or pause', () => {
  for (const text of ["I'm done with the lesson", "let’s stop here", 'end lesson', "that's all for today", 'finish the lesson please']) assert.equal(isLessonEnding(text), true, text);
  for (const text of ['done', 'pause', 'stop drawing', 'When does the lesson end?', "I'm done with the problem", "don't end the lesson"]) assert.equal(isLessonEnding(text), false, text);
});
