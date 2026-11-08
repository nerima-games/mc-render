import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(root, 'src/assets/block-textures');
const destinationDirectory = resolve(root, 'dist/assets/block-textures');

await mkdir(destinationDirectory, { recursive: true });
await Promise.all(
  ['atlas.png', 'manifest.json'].map((filename) =>
    copyFile(resolve(sourceDirectory, filename), resolve(destinationDirectory, filename)),
  ),
);
