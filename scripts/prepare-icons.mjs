import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const mediaDir = join(root, 'media');

const SOURCE_FILENAME =
  'c__Users_berwi_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Gemini_Generated_Image_e3wxete3wxete3wx-c5d86948-00b4-493f-a281-b6b1d909a18b.png';

const sourceCandidates = [
  join(root, 'assets', SOURCE_FILENAME),
  '/mnt/c/Users/berwi/.cursor/projects/wsl-localhost-Ubuntu-home-berwin-SaaS-docq-one-click-terminal-setup-vscode/assets/' +
    SOURCE_FILENAME,
  'C:/Users/berwi/.cursor/projects/wsl-localhost-Ubuntu-home-berwin-SaaS-docq-one-click-terminal-setup-vscode/assets/' +
    SOURCE_FILENAME,
];

const WHITE_BG = { r: 255, g: 255, b: 255, alpha: 1 };
const SQUARE_TOLERANCE = 0.01;

const source = sourceCandidates.find((candidate) => existsSync(candidate));
if (!source) {
  console.error('Source icon not found. Checked:', sourceCandidates);
  process.exit(1);
}

let sharp;
try {
  const require = createRequire(import.meta.url);
  sharp = require('sharp');
  // Verify sharp actually loads (native binary + Node version)
  sharp.versions;
} catch {
  sharp = null;
}

if (!sharp) {
  const { spawnSync } = await import('node:child_process');
  const bashScript = join(__dirname, 'prepare-icons.sh');
  console.warn('sharp unavailable; falling back to ffmpeg script');
  const result = spawnSync('bash', [bashScript], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

await mkdir(mediaDir, { recursive: true });

const metadata = await sharp(source).metadata();
const { width, height } = metadata;
if (!width || !height) {
  console.error('Could not read source dimensions:', source);
  process.exit(1);
}

const aspect = width / height;
const isSquare = Math.abs(aspect - 1) <= SQUARE_TOLERANCE;

console.log(`Source: ${source}`);
console.log(`Source dimensions: ${width}x${height} (aspect ${aspect.toFixed(3)}, square=${isSquare})`);

/** @param {import('sharp').Sharp} image @param {number} size */
async function writeSquareIcon(image, size, outputPath) {
  const resized = image.clone().resize(size, size, {
    fit: 'fill',
    background: WHITE_BG,
  });

  await resized.png({ compressionLevel: 9 }).toFile(outputPath);

  const outMeta = await sharp(outputPath).metadata();
  console.log(`Created ${outputPath} (${outMeta.width}x${outMeta.height})`);
}

let squareImage = sharp(source);

if (!isSquare) {
  const cropSize = Math.min(width, height);
  const left = Math.floor((width - cropSize) / 2);
  const top = Math.floor((height - cropSize) / 2);

  console.log(`Center-cropping to ${cropSize}x${cropSize} at (${left}, ${top})`);
  squareImage = sharp(source).extract({
    left,
    top,
    width: cropSize,
    height: cropSize,
  });
}

await writeSquareIcon(squareImage, 128, join(mediaDir, 'icon.png'));
await writeSquareIcon(squareImage, 256, join(mediaDir, 'icon-256.png'));
