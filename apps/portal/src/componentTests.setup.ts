import { beforeAll } from 'vitest';
import { settleTestFrame } from './testFrame.test-support.ts';

// Every component test file first waits until the browser provider reaches its frame (see
// settleTestFrame), so a new file cannot fail its first click or key on a busy machine.
beforeAll(settleTestFrame);
