// ============================================================================
// IMAGE SCRIPT — DEV / WATCHER / BUILD OPTIMIZED + PARALLEL WATCHER
// ============================================================================

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import imagemin from 'imagemin';
import imageminMozjpeg from 'imagemin-mozjpeg';
import imageminPngquant from 'imagemin-pngquant';
import imageminSvgo from 'imagemin-svgo';
import chokidar from 'chokidar';

// ---------------- MODE ----------------
const isBuild = process.argv.includes('build');
const isDev = !isBuild;

// ---------------- PATHS ----------------
const globalSrc = 'src/images/src';
const modulesDir = 'src/modules';
const devOutputDir = 'src/images';
const buildOutputDir = 'dist/images';
const outputDir = isBuild ? buildOutputDir : devOutputDir;

// ---------------- CONFIG ----------------
const rasterExts = ['.png', '.jpg', '.jpeg'];
const svgExts = ['.svg'];
const generatedFormats = ['.webp', '.avif'];
const formats = ['webp', 'avif'];
const excludeFolder = 'sprite-src';
const ignoredBuildFolders = ['src', 'sprite-src'];

// ---------------- FLAGS ----------------
let isInitialRun = true;

// ---------------- UTILS ----------------
function normalize(p) {
    return p.replace(/\\/g, '/');
}

async function ensureDir(dir) {
    await fsp.mkdir(dir, { recursive: true });
}

async function fileExists(p) {
    try {
        await fsp.access(p);
        return true;
    } catch {
        return false;
    }
}

async function isUpToDate(src, dest) {
    if (!(await fileExists(dest))) return false;
    const srcStat = await fsp.stat(src);
    const destStat = await fsp.stat(dest);
    return destStat.mtimeMs >= srcStat.mtimeMs;
}

function isGenerated(filePath) {
    return generatedFormats.includes(path.extname(filePath).toLowerCase());
}

// ---------------- PATH RESOLVERS ----------------
function getDestPathForGlobal(filePath) {
    const rel = path.relative(globalSrc, filePath);
    return path.join(outputDir, rel);
}

function getDestPathForModule(filePath) {
    const fp = normalize(filePath);
    const relAfterModules = fp.split('/modules/')[1];
    if (!relAfterModules) return null;

    const [moduleName, ...rest] = relAfterModules.split('/');
    const idx = rest.indexOf('images');
    if (idx === -1) return null;

    const inside = rest.slice(idx + 1).join('/');
    return path.join(outputDir, moduleName, inside);
}

function resolveOutputPath(filePath) {
    const fp = normalize(filePath);
    if (fp.startsWith(normalize(globalSrc))) return getDestPathForGlobal(fp);
    if (fp.includes('src/modules/') && fp.includes('/images/')) return getDestPathForModule(fp);
    return null;
}

// ---------------- IMAGE PROCESSING ----------------
async function convertWithSharp(filePath, destPath, format) {
    if (!(await fileExists(filePath))) return;
    if (await isUpToDate(filePath, destPath)) return;

    await ensureDir(path.dirname(destPath));
    await sharp(filePath)
        .toFormat(format, format === 'avif' ? { quality: 50 } : { quality: 80 })
        .toFile(destPath);

    console.log(`[Converted → ${format}]`, normalize(destPath));
}

async function optimizeRaster(filePath, destDir) {
    await ensureDir(destDir);
    await imagemin([filePath], {
        destination: destDir,
        plugins: [
            imageminMozjpeg({ quality: 80 }),
            imageminPngquant({ quality: [0.6, 0.8] }),
        ],
    });
    console.log('[Raster Optimized]', normalize(filePath));
}

async function optimizeSvg(filePath, destDir) {
    await ensureDir(destDir);
    await imagemin([filePath], { destination: destDir, plugins: [imageminSvgo()] });
    console.log('[SVG Optimized]', normalize(filePath));
}

async function processFile(filePath, destPath) {
    const ext = path.extname(filePath).toLowerCase();
    const destDir = path.dirname(destPath);

    if (filePath.includes(`/${excludeFolder}/`)) return;

    if (isDev) {
        // ---------------- RASTER ----------------
        if (rasterExts.includes(ext)) {
            await ensureDir(destDir);

            const destOriginal = path.join(destDir, path.basename(filePath));

            const needsUpdate = !(await isUpToDate(filePath, destOriginal));

            // 🔥 якщо файл вже актуальний — повністю пропускаємо
            if (!needsUpdate) return;

            // Копіюємо оригінал
            await fsp.copyFile(filePath, destOriginal);
            console.log('[Copied]', normalize(filePath));

            // Генеруємо webp/avif тільки якщо було оновлення
            await Promise.all(
                formats.map(format =>
                    convertWithSharp(
                        filePath,
                        path.join(
                            destDir,
                            path.basename(filePath, ext) + '.' + format
                        ),
                        format
                    )
                )
            );

            // Оптимізуємо тільки якщо було оновлення
            await optimizeRaster(destOriginal, destDir);
        }

        // ---------------- SVG ----------------
        else if (svgExts.includes(ext)) {
            const destSvg = path.join(destDir, path.basename(filePath));
            const needsUpdate = !(await isUpToDate(filePath, destSvg));

            if (!needsUpdate) return;

            await optimizeSvg(filePath, destDir);
        }
    }
}

// ---------------- WALKER ----------------
async function walkDirAsync(dir, cb) {
    if (!(await fileExists(dir))) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === excludeFolder) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walkDirAsync(full, cb);
        else await cb(full);
    }
}

// ---------------- REMOVE FILES ----------------
async function removeOutputFiles(sourcePath) {
    const normalized = normalize(sourcePath);
    if (normalized.includes(`/${excludeFolder}/`)) return;

    const dest = resolveOutputPath(normalized);
    if (!dest) return;

    const dir = path.dirname(dest);
    const base = path.basename(dest, path.extname(dest));
    const filesToRemove = [
        dest,
        path.join(dir, base + '.webp'),
        path.join(dir, base + '.avif'),
    ];

    for (const f of filesToRemove) {
        if (fs.existsSync(f)) {
            await fsp.unlink(f);
            console.log('[Removed File]', normalize(f));
        }
    }

    await clearEmptyDirsUpward(dir);
}

async function clearEmptyDirsUpward(dir) {
    try {
        if (!(await fileExists(dir))) return;

        const items = await fsp.readdir(dir);
        if (items.length > 0) return;

        await fsp.rmdir(dir);
        console.log('[Removed Empty Dir]', dir);

        const parent = path.dirname(dir);
        if (normalize(parent) !== normalize(devOutputDir) && normalize(parent) !== normalize(buildOutputDir)) {
            await clearEmptyDirsUpward(parent);
        }
    } catch (e) {
        if (['EPERM', 'EBUSY', 'ENOENT'].includes(e.code)) return;
        throw e;
    }
}

// ---------------- MAIN ----------------
export async function runImageConvert(server) {
    console.log('[ImageConvert] Start');

    if (isBuild) {
        console.log('[ImageConvert] Build mode → copy filtered images');
        await ensureDir(buildOutputDir);

        const entries = await fsp.readdir(devOutputDir, { withFileTypes: true });
        for (const entry of entries) {
            if (ignoredBuildFolders.includes(entry.name)) continue;
            const srcPath = path.join(devOutputDir, entry.name);
            const destPath = path.join(buildOutputDir, entry.name);
            await fsp.cp(srcPath, destPath, { recursive: true });
        }

        console.log('[ImageConvert] Build copy done');
        return;
    }

    // DEV MODE
    await walkDirAsync(globalSrc, async fp => {
        const dest = getDestPathForGlobal(fp);
        await processFile(fp, dest);
    });

    if (await fileExists(modulesDir)) {
        const modules = await fsp.readdir(modulesDir);
        for (const module of modules) {
            const imgDir = path.join(modulesDir, module, 'images');
            if (!(await fileExists(imgDir))) continue;
            await walkDirAsync(imgDir, async fp => {
                const dest = getDestPathForModule(fp);
                if (dest) await processFile(fp, dest);
            });
        }
    }

    console.log('[ImageConvert] Done');

    if (server && isInitialRun) server.ws.send({ type: 'full-reload', path: '*' });
    isInitialRun = false;
}

// ---------------- WATCHER ----------------
export function startImageWatcher(server) {
    const watcher = chokidar.watch(['src/images/src', 'src/modules'], {
        ignored: /sprite-src/,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    const pendingFiles = new Set();
    let processTimeout = null;
    const MAX_PARALLEL = 4; // максимальна кількість одночасних обробок

    const processBatch = async (files) => {
        while (files.length > 0) {
            const batch = files.splice(0, MAX_PARALLEL);
            await Promise.all(
                batch.map(async (fp) => {
                    const dest = resolveOutputPath(fp);
                    if (dest) await processFile(fp, dest);
                })
            );
        }
    };

    const scheduleProcessing = async () => {
        if (pendingFiles.size === 0) return;
        const files = Array.from(pendingFiles);
        pendingFiles.clear();
        await processBatch(files);
        if (!isInitialRun) server.ws.send({ type: 'full-reload', path: '*' });
    };

    watcher.on('all', (event, filePath) => {
        const fp = normalize(filePath);
        if (fp.includes(`/${excludeFolder}/`) || isGenerated(fp)) return;

        if (event === 'add' || event === 'change') {
            pendingFiles.add(fp);
            if (processTimeout) clearTimeout(processTimeout);
            processTimeout = setTimeout(scheduleProcessing, 50); // через 50ms обробляємо всі зміни
        }

        if (event === 'unlink') {
            removeOutputFiles(fp).then(() => {
                if (!isInitialRun) server.ws.send({ type: 'full-reload', path: '*' });
            });
        }
    });

    watcher.on('ready', () => console.log('[Watcher] Ready'));
}
