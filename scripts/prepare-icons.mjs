import { mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const mediaDir = join(root, 'media');

const sourceCandidates = [
  join(
    root,
    'assets',
    'c__Users_berwi_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Gemini_Generated_Image_e3wxete3wxete3wx-c5d86948-00b4-493f-a281-b6b1d909a18b.png',
  ),
  '/mnt/c/Users/berwi/.cursor/projects/wsl-localhost-Ubuntu-home-berwin-SaaS-docq-one-click-terminal-setup-vscode/assets/c__Users_berwi_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Gemini_Generated_Image_e3wxete3wxete3wx-c5d86948-00b4-493f-a281-b6b1d909a18b.png',
  'C:/Users/berwi/.cursor/projects/wsl-localhost-Ubuntu-home-berwin-SaaS-docq-one-click-terminal-setup-vscode/assets/c__Users_berwi_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Gemini_Generated_Image_e3wxete3wxete3wx-c5d86948-00b4-493f-a281-b6b1d909a18b.png',
];

const source = sourceCandidates.find((candidate) => existsSync(candidate));
if (!source) {
  console.error('Source icon not found. Checked:', sourceCandidates);
  process.exit(1);
}

await mkdir(mediaDir, { recursive: true });

let sharp;
try {
  const require = createRequire(import.meta.url);
  sharp = require('sharp');
} catch {
  sharp = null;
}

if (sharp) {
  const image = sharp(source);
  await image.clone().resize(128, 128, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png({ compressionLevel: 9 }).toFile(join(mediaDir, 'icon.png'));
  await image.clone().resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png({ compressionLevel: 9 }).toFile(join(mediaDir, 'icon-256.png'));
  console.log('Created media/icon.png (128x128) and media/icon-256.png (256x256) with sharp');
} else {
  await copyFile(source, join(mediaDir, 'icon.png'));
  await copyFile(source, join(mediaDir, 'icon-256.png'));
  console.warn('sharp not installed; copied source PNG without resize');
}
