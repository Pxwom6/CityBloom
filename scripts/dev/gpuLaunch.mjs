// The browser for the phase-6 picture scripts (matchshot, challengeshot, timelapseshot, buildingsshot).
// By default Playwright's Chromium on SwiftShader at Low (as the cloud VM runs them); `GPU=1` opens a
// headed Chrome window on the real GPU at High with shadows, for pictures that show the game as it
// looks (the README's). Windows behind others aren't throttled, so several players' pages keep up.
import { chromium } from 'playwright';

export const GPU = process.env.GPU === '1';

/** The graphics a page starts on: `QUALITY` if given, else High on the GPU and Low on SwiftShader. */
export const QUALITY = process.env.QUALITY ?? (GPU ? 'high' : 'low');
export const SHADOWS = GPU && QUALITY !== 'low' && QUALITY !== 'phone';

export function launchBrowser(extra = {}) {
  return chromium.launch(
    GPU
      ? {
          channel: 'chrome',
          headless: false,
          args: [
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
          ],
          ...extra,
        }
      : {
          args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
          ...extra,
        },
  );
}
