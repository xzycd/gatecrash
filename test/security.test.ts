import {describe, expect, it} from 'vitest';
import {terminalText} from '../src/utils/security.js';

describe('terminal text safety', () => {
  it('removes escape, line, carriage-return, C1, and bidi controls', () => {
    expect(terminalText('safe\u001B[31m\nnext\rover\u0085\u202Eend')).toBe(
      'safe[31mnextoverend',
    );
  });
});
