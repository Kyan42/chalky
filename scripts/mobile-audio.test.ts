import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unlockVoice } from '../lib/voice/audio';

test('one tap starts resuming playback and capture before either promise resolves', async () => {
  const instances: FakeContext[] = [];
  class FakeContext {
    state = 'suspended';
    destination = {};
    release!: () => void;
    constructor() { instances.push(this); }
    addEventListener() {}
    resume() { return new Promise<void>(resolve => { this.release = () => { this.state = 'running'; resolve(); }; }); }
    createGain() { return { connect: () => ({ connect() {} }) }; }
    createAnalyser() { return { fftSize: 0 }; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { value: FakeContext, configurable: true });
  const ready = unlockVoice();
  assert.equal(instances.length, 2, 'both audio contexts must be created inside the tap');
  assert.ok(instances.every(c => c.release), 'both resume calls must run before awaiting');
  instances.forEach(c => c.release());
  await ready;
});
