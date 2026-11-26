// Package only explicitly shipped assets. The relay never serves the repository.
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

const dist = new URL('./dist/', import.meta.url);
const target = (name) => new URL(name, dist);
const copy = (from, name) => cpSync(new URL(from, import.meta.url), target(name));
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const name of readdirSync(new URL('./public/', import.meta.url)))
  copy('./public/' + name, name);
const resources = '../Sources/App/Resources/';
copy(resources + 'Assets.xcassets/AppIcon.appiconset/icon_512.png', 'icon-512.png');
copy(resources + 'Fonts/SpaceGrotesk-Variable.ttf', 'space.ttf');
copy(resources + 'Fonts/Syne-Variable.ttf', 'syne.ttf');
copy(resources + 'Fonts/OFL-Syne.txt', 'OFL-Syne.txt');
copy(resources + 'Fonts/OFL-SpaceGrotesk.txt', 'OFL-SpaceGrotesk.txt');
copy('../LICENSE', 'LICENSE.txt');
copy('../docs/brand/vendor/LICENSE-fluent-emoji', 'LICENSE-emoji.txt');
const files = readdirSync(dist)
  .filter((name) => name !== 'sw.js' && !name.endsWith('.txt'))
  .sort();
const hash = createHash('sha256');
for (const name of [...files, 'sw.js']) hash.update(name).update(readFileSync(target(name)));
const worker = readFileSync(target('sw.js'), 'utf8')
  .replace('__VERSION__', hash.digest('hex').slice(0, 16))
  .replace('/* assets */ []', JSON.stringify(['/', ...files.map((name) => '/' + name)]));
writeFileSync(target('sw.js'), worker);
console.log('Packaged companion in dist/');
