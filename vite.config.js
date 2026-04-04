import {defineConfig} from "vite";
import fs from "fs";
import path from "path";
import autoprefixer from "autoprefixer";
import babel from "@rollup/plugin-babel";
import {runImageConvert, startImageWatcher} from './vite/tasks/imagesConvert.js';
import runSvgSprite from './vite/tasks/svgSprite.js';
import fontPlugin from './vite/tasks/fontsGeneration.js';
import htmlInclude from "vite-plugin-html-include";
import {aliasInHtmlPlugin} from './vite/tasks/aliasInHtmlPlugin.js';

// Генерація input для Rollup
const generateNestedInputs = (pagesDir) => {
    const inputs = {};

    const walkDir = (currentDir) => {
        const entries = fs.readdirSync(currentDir, {withFileTypes: true});

        for (const entry of entries) {
            const fullPath = path.resolve(currentDir, entry.name);

            if (entry.isDirectory()) {
                walkDir(fullPath);
            } else if (entry.isFile() && path.extname(entry.name) === '.html') {
                // Строго відносно папки pages
                const relativePath = path.relative(pagesDir, fullPath);

                // Отримуємо шлях без .html і приводимо до слешів `/`
                const key = relativePath.slice(0, -5).split(path.sep).join('/');

                inputs[key] = fullPath;
            }
        }
    };

    walkDir(pagesDir);
    return inputs;
};

const alias = {
    '@': path.resolve(__dirname, 'src'),
    '@pages': path.resolve(__dirname, 'src/pages'),
    '@modules': path.resolve(__dirname, 'src/modules'),
    '@scss': path.resolve(__dirname, 'src/scss'),
    '@images': path.resolve(__dirname, 'src/images'),
}

// Конфіг Vite
export default defineConfig(({command, mode}) => {
    // Перевіряємо і команду, і режим одночасно
    const isProd = command === 'build' || mode === 'production';

    console.log('--- DEBUG ---');
    console.log('Command:', command);
    console.log('Mode:', mode);
    console.log('Is Prod:', isProd);
    console.log('-------------');

    return {
        root: 'src',
        base: './',
        publicDir: '../public',
        server: {
            port: 8080,
            open: '/',
        },
        plugins: [
            {
                name: 'images-and-sprite',

                configureServer(server) {
                    // Обробка всіх картинок + передаємо server
                    runImageConvert(server);
                    // Запуск watcher для картинок + передаємо server
                    startImageWatcher(server);

                    // Спрайт
                    runSvgSprite({server}); // генерація + watcher для спрайту
                },

                async writeBundle() {
                    // Build: обробка картинок і формати
                    await runImageConvert();
                    runSvgSprite(); // генерація спрайту

                    // Копіюємо спрайт у dist
                    const spriteSrc = 'src/assets/images/sprite.svg';
                    const spriteDist = 'dist/assets/images/sprite.svg';
                    if (fs.existsSync(spriteSrc)) {
                        fs.mkdirSync(path.dirname(spriteDist), {recursive: true});
                        fs.copyFileSync(spriteSrc, spriteDist);
                    }
                },
            },
            fontPlugin({
                inDir: "src/fonts/src",          // Твої .ttf файли тут
                outDir: "src/fonts",            // Результати (.woff2) будуть тут
                outScss: "src/scss/_fonts.scss",
                varsScss: "src/scss/_vars.scss"
            }),
            htmlInclude(),
            {
                name: 'remove-modules-from-dist',
                closeBundle() {
                    const modulesDistPath = path.resolve(__dirname, 'dist/modules')
                    if (fs.existsSync(modulesDistPath)) {
                        fs.rmSync(modulesDistPath, {recursive: true, force: true})
                        console.log('Папка modules успішно видалена з dist.')
                    }
                }
            },
            aliasInHtmlPlugin(alias, command === 'build'),
        ],
        resolve: {
            alias: alias
        },
        css: {
            // ... у блоці scss
            preprocessorOptions: {
                scss: {
                    additionalData: `
        @use "@scss/vars" as * with (
            $isProd: ${isProd}, 
            $env: "${isProd ? 'production' : 'development'}"
        );
    `,
                }
            },
            postcss: command === 'build' ? {
                plugins: [autoprefixer({grid: true, flexbox: 'no-2009', remove: false})]
            } : undefined
        },
        build: {
            outDir: '../dist',
            emptyOutDir: true,
            assetsDir: 'assets',
            rollupOptions: {
                input: generateNestedInputs('src'),
                plugins: [
                    babel({babelHelpers: 'bundled', extensions: ['.js', '.mjs', '.cjs'], babelrc: true})
                ],
                output: {
                    entryFileNames: 'js/[name].js',
                    chunkFileNames: 'js/[name].js',
                    assetFileNames: (assetInfo) => {
                        const ext = assetInfo.names?.[0]?.split('.').pop()?.toLowerCase();

                        if (['woff', 'woff2'].includes(ext)) {
                            return 'fonts/[name][extname]';
                        }

                        if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg', 'ico', 'gif'].includes(ext)) {
                            return 'filesFromCss/[name][extname]';
                        }

                        if (ext === 'css') {
                            return 'css/[name][extname]';
                        }

                        // Всі інші assets (не картинки)
                        return '[name]-[hash][extname]';
                    }
                }
            }
        }
    }
});
