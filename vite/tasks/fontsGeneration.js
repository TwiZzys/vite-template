import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, extname, basename } from "path";
import chokidar from "chokidar";
import fontverter from "fontverter";

// Мапа ключових слів → числовий weight
const weightMap = {
    thin: 100,
    extralight: 200,
    ultralight: 200,
    light: 300,
    regular: 400,
    book: 400,
    medium: 500,
    semibold: 600,
    demibold: 600,
    bold: 700,
    extrabold: 800,
    heavy: 800,
    black: 900
};

/**
/**
 * Парсити назву шрифту і визначати family, weight, style + варіанти для local()
 */
function parseFontName(name) {
    const clean = name.replace(/\.(ttf|otf)$/i, "");

    // 1. Унікальна назва для CSS та Міксина (наприклад, RobotoLight)
    const family = clean.replace(/[-_]/g, "");

    // 2. Варіанти для системного пошуку src: local()
    // Створюємо масив варіацій, щоб різні ОС могли знайти шрифт
    const localWithSpace = clean.replace(/[-_]/g, " "); // "Roboto Light"
    const localWithDash = clean;                         // "Roboto-Light"
    const localSolid = family;                          // "RobotoLight"

    const parts = clean.split(/[-_]+/);
    let weight = 400;
    let style = "normal";

    // Визначаємо вагу та стиль за ключовими словами
    parts.forEach((part) => {
        const low = part.toLowerCase();
        if (low.includes("italic")) style = "italic";
        if (weightMap[low]) weight = weightMap[low];
    });

    return {
        family,
        weight,
        style,
        baseName: clean,
        localVariants: [localWithSpace, localWithDash, localSolid]
    };
}

/**
 * Генерація шрифтів та mixin-ів
 */
async function generateFonts(fontDir, outScss, varsScss) {
    if (!existsSync(fontDir)) return [];

    const files = readdirSync(fontDir).filter(f => /\.(ttf|otf)$/i.test(f));
    let scss = "";
    let varsContent = "";

    for (const file of files) {
        const fontPath = join(fontDir, file);
        const ext = extname(file);
        const base = basename(file, ext);

        const parsed = parseFontName(base);
        const fontBuffer = readFileSync(fontPath);

        // Конвертація у woff2 та woff
        const woff2Buf = await fontverter.convert(fontBuffer, "woff2");
        const woff2Filename = base + ".woff2";
        writeFileSync(join(fontDir, woff2Filename), woff2Buf);

        const woffBuf = await fontverter.convert(fontBuffer, "woff");
        const woffFilename = base + ".woff";
        writeFileSync(join(fontDir, woffFilename), woffBuf);

        // Формуємо список local() для src
        const localSrc = parsed.localVariants
            .map(v => `local("${v}")`)
            .join(", ");

        // @font-face
        scss += `@font-face {
  font-family: "${parsed.family}";
  font-weight: ${parsed.weight};
  font-style: ${parsed.style};
  font-display: swap;
  src: ${localSrc},
       url("../fonts/${woff2Filename}") format("woff2"),
       url("../fonts/${woffFilename}") format("woff");
}\n\n`;

        // Міксин (назва міксина ідентична унікальному font-family)
        varsContent += `@mixin ${parsed.family}() {
  font-family: '${parsed.family}', sans-serif;
  font-weight: ${parsed.weight};
  font-style: ${parsed.style};
}\n\n`;
    }

    // Створення директорії, якщо її немає
    const dir = outScss.split(/[\\/]/).slice(0, -1).join("/");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Оновлення файлів стилів
    writeFileSync(outScss, scss);

    let varsRaw = "";
    if (existsSync(varsScss)) varsRaw = readFileSync(varsScss, "utf-8");

    const startMarker = "// ==== FONTS START ====";
    const endMarker = "// ==== FONTS END ====";
    const startIndex = varsRaw.indexOf(startMarker);
    const endIndex = varsRaw.indexOf(endMarker);

    let newVars = "";
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        newVars = varsRaw.slice(0, startIndex + startMarker.length) + "\n\n" +
            varsContent +
            varsRaw.slice(endIndex);
    } else {
        newVars = varsRaw + "\n\n" + startMarker + "\n\n" + varsContent + endMarker + "\n";
    }

    writeFileSync(varsScss, newVars);

    console.log(`[vite-fonts-auto] Updated with ${files.length} fonts. Local-safe mode enabled.`);
    return files;
}
/**
 * Видалення шрифту (mixins + font-face + woff/woff2)
 */
async function removeFont(fontFile, fontDir, outScss, varsScss) {
    const base = basename(fontFile, extname(fontFile));
    const parsed = parseFontName(base);

    // Видаляємо woff та woff2
    const woff = join(fontDir, base + ".woff");
    const woff2 = join(fontDir, base + ".woff2");

    [woff, woff2].forEach(f => {
        if (existsSync(f)) {
            unlinkSync(f);
            console.log(`[vite-fonts-auto] Deleted file: ${f}`);
        }
    });

    // Вилучаємо @font-face
    let fontsRaw = existsSync(outScss) ? readFileSync(outScss, "utf-8") : "";
    const regexFace = new RegExp(`@font-face\\s*{[\\s\\S]*?${parsed.family}[\\s\\S]*?}`, "gi");
    fontsRaw = fontsRaw.replace(regexFace, "");
    writeFileSync(outScss, fontsRaw);

    // Вилучаємо mixin
    let varsRaw = existsSync(varsScss) ? readFileSync(varsScss, "utf-8") : "";
    const mixinName = parsed.baseName.replace(/[-_]/g, "");
    const regexMixin = new RegExp(`@mixin\\s+${mixinName}\\(\\)[\\s\\S]*?\\}`, "gi");
    varsRaw = varsRaw.replace(regexMixin, "");
    writeFileSync(varsScss, varsRaw);

    console.log(`[vite-fonts-auto] Removed font: ${parsed.baseName}`);
}

/**
 * Плагін Vite
 */
export default function fontPlugin(options = {}) {
    const fontDir = options.fontDir || "src/fonts";
    const outScss = options.outScss || "src/scss/_fonts.scss";
    const varsScss = options.varsScss || "src/scss/_vars.scss";

    return {
        name: "vite-fonts-auto",
        apply: "serve",
        async configResolved() {
            await generateFonts(fontDir, outScss, varsScss);

            const watcher = chokidar.watch(fontDir, {
                ignoreInitial: true,
                ignored: /(\.woff2?|\.DS_Store)$/i
            });

            watcher.on("add", async path => {
                console.log(`[vite-fonts-auto] Added font: ${basename(path)}`);
                await generateFonts(fontDir, outScss, varsScss);
            });

            watcher.on("unlink", async path => {
                await removeFont(path, fontDir, outScss, varsScss);
                await generateFonts(fontDir, outScss, varsScss);
            });

            watcher.on("change", async path => {
                console.log(`[vite-fonts-auto] Changed font: ${basename(path)}`);
                await generateFonts(fontDir, outScss, varsScss);
            });
        }
    };
}
