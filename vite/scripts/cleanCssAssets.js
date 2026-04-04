import fs from 'fs';
import path from 'path';

const dir = path.resolve('dist/filesFromCss');

if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
}