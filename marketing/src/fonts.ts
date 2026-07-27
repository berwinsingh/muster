/**
 * Fonts are loaded from @remotion/google-fonts rather than a <link> to
 * Google's CDN: the renderer opens each frame in a fresh browser page, and
 * a font that arrives a few frames late shows up as a visible reflow in the
 * middle of the video. These are bundled, so every frame measures the same.
 */
import { loadFont as loadSans } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

export const sans = loadSans('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin'],
}).fontFamily;

export const mono = loadMono('normal', {
  weights: ['400', '500', '600'],
  subsets: ['latin'],
}).fontFamily;
