/**
 * Checking a weekly challenge run off the page's thread (M44): replay it from the challenge alone and
 * say whether it came to the hash and score it claims. Pure sim code, so every machine agrees.
 */
import { replayRun, type ChallengeRun, type ReplayResult } from '../sim/runReplay';

export interface RunCheckJob {
  id: number;
  run: ChallengeRun;
}

export type RunCheckReply = { id: number; result: ReplayResult } | { id: number; error: string };

self.onmessage = (e: MessageEvent<RunCheckJob>) => {
  const { id, run } = e.data;
  let reply: RunCheckReply;
  try {
    reply = { id, result: replayRun(run) };
  } catch (err) {
    reply = { id, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(reply);
};
