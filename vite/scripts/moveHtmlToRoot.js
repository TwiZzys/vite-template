// move-html-to-root.js
import fs from 'fs';
import path from 'path';

const distDir = path.resolve('./dist');
const pagesDir = path.join(distDir, 'pages');

if (!fs.existsSync(pagesDir)) {
    console.log('Папка pages не знайдена у dist. Немає файлів для переміщення.');
    process.exit(0);
}

// Рекурсивно отримуємо всі підпапки з HTML
const getHtmlFiles = (dir) => {
    const htmlFiles = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });

    items.forEach(item => {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            htmlFiles.push(...getHtmlFiles(fullPath));
        } else if (item.isFile() && path.extname(item.name) === '.html') {
            htmlFiles.push(fullPath);
        }
    });

    return htmlFiles;
};

const files = getHtmlFiles(pagesDir);

files.forEach(file => {
    const relativePath = path.relative(pagesDir, file); // відносно pages
    const parts = relativePath.split(path.sep);
    const folderName = parts.length > 1 ? parts[0] : 'home';

    // Визначаємо ім'я файлу у руті dist
    let fileName;
    if (folderName === 'home') {
        fileName = 'index.html'; // home → index
    } else {
        fileName = folderName + '.html'; // інші → about.html, contact.html і тд
    }

    let destFile = path.join(distDir, fileName);

    // якщо файл вже існує → додаємо префікс
    if (fs.existsSync(destFile)) {
        const parsed = path.parse(fileName);
        destFile = path.join(distDir, `copy-${parsed.base}`);
    }

    fs.renameSync(file, destFile);
    console.log(`Перенесено: ${file} → ${path.basename(destFile)}`);
});

// Видаляємо тільки порожню папку pages у dist
try {
    fs.rmSync(pagesDir, { recursive: true, force: true });
    console.log('Папка pages у dist видалена.');
} catch (err) {
    console.error('Не вдалося видалити dist/pages:', err);
}
