import fs from "fs";
import path from "path";
import { load } from "cheerio";
import { optimize } from "svgo";
import crypto from "crypto";

const spriteOutput = "src/images/sprite.svg";
const globalSrc = "src/images/sprite-src";
const modulesDir = "src/modules";
const cacheFile = ".svg-sprite-cache.json";

let cache = fs.existsSync(cacheFile)
    ? JSON.parse(fs.readFileSync(cacheFile, "utf8"))
    : {};

const hash = (str) =>
    crypto.createHash("sha256").update(str).digest("hex");

// --------------------------------------------------
// WALK DIR
// --------------------------------------------------
const walkDir = (dir, cb) => {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach((file) => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkDir(full, cb);
    else if (file.endsWith(".svg")) cb(full);
  });
};

// --------------------------------------------------
// CLEAN + NORMALIZE SVG (CSS-CONTROLLED)
// --------------------------------------------------
const cleanSvg = (svgContent, filePath = "") => {
  let optimized;

  try {
    optimized = optimize(svgContent, {
      multipass: true,
      floatPrecision: 3,
      plugins: [
        "removeDoctype",
        "removeXMLProcInst",
        "removeComments",
        "removeMetadata",
        "removeEditorsNSData",
        "removeTitle",
        "removeDesc",
        "removeUselessDefs",
        "removeHiddenElems",
        "removeDimensions",
        "cleanupNumericValues",
        "convertStyleToAttrs",
        "convertPathData",
        "sortAttrs",
      ],
    }).data;
  } catch (e) {
    console.warn(`[SVG Sprite] SVGO error (${filePath}):`, e.message);
    return null;
  }

  const $ = load(optimized, { xmlMode: true });
  const $svg = $("svg");

  if (!$svg.length) {
    console.warn(`[SVG Sprite] Invalid SVG skipped: ${filePath}`);
    return null;
  }

  // ---- root svg ----
  const viewBox = $svg.attr("viewBox");
  $svg.attr({});
  if (viewBox) $svg.attr("viewBox", viewBox);

  // ---- normalize children ----
  $svg.find("*").each((_, el) => {
    const $el = $(el);

    // remove junk
    $el.removeAttr(
        "class id style opacity color width height data-name data-testid"
    );

    const fill = $el.attr("fill");
    const stroke = $el.attr("stroke");

    // color fills → currentColor
    if (fill && fill !== "none") {
      $el.attr("fill", "currentColor");
    }

    // strokes → currentColor
    if (stroke && stroke !== "none") {
      $el.attr("stroke", "currentColor");
    }

    // if nothing defined → fill shape
    if (!fill && !stroke) {
      $el.attr("fill", "currentColor");
    }
  });

  return $.xml($svg)
      .replace(/\n+/g, "")
      .replace(/\s{2,}/g, " ");
};

// --------------------------------------------------
// SPRITE GENERATOR
// --------------------------------------------------
const generateSprite = (server = null) => {
  let sprite =
      '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n';

  let hasIcons = false;
  let compiledIcons = "";
  const newCache = {};

  const addIcon = (filePath, id) => {
    const raw = fs.readFileSync(filePath, "utf8");
    const fileHash = hash(raw);
    newCache[filePath] = fileHash;

    if (cache[filePath] === fileHash && cache[`svg:${filePath}`]) {
      compiledIcons += cache[`svg:${filePath}`] + "\n";
      return;
    }

    const cleaned = cleanSvg(raw, filePath);
    if (!cleaned) return;

    // SVG → SYMBOL (CRITICAL)
    const symbol = cleaned
        .replace("<svg", `<symbol id="${id}"`)
        .replace("</svg>", "</symbol>");

    compiledIcons += symbol + "\n";
    newCache[`svg:${filePath}`] = symbol;
  };

  // global icons
  walkDir(globalSrc, (file) => {
    hasIcons = true;
    addIcon(file, path.basename(file, ".svg"));
  });

  // module icons
  if (fs.existsSync(modulesDir)) {
    fs.readdirSync(modulesDir).forEach((mod) => {
      const spriteDir = path.join(
          modulesDir,
          mod,
          "images",
          "sprite-src"
      );
      if (!fs.existsSync(spriteDir)) return;

      walkDir(spriteDir, (file) => {
        hasIcons = true;
        addIcon(file, `${mod}-${path.basename(file, ".svg")}`);
      });
    });
  }

  sprite += compiledIcons + "</svg>";

  if (!hasIcons) {
    if (fs.existsSync(spriteOutput)) fs.unlinkSync(spriteOutput);
    fs.writeFileSync(cacheFile, JSON.stringify(newCache, null, 2));
    if (server) server.ws.send({ type: "full-reload", path: "*" });
    return;
  }

  const spriteHash = hash(sprite);

  if (cache.__spriteHash === spriteHash) {
    fs.writeFileSync(cacheFile, JSON.stringify(newCache, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(spriteOutput), { recursive: true });
  fs.writeFileSync(spriteOutput, sprite, "utf8");

  newCache.__spriteHash = spriteHash;
  fs.writeFileSync(cacheFile, JSON.stringify(newCache, null, 2));

  console.log("[SVG Sprite] Sprite updated.");

  if (server) {
    server.ws.send({ type: "full-reload", path: "*" });
  }
};

// --------------------------------------------------
// VITE PLUGIN EXPORT
// --------------------------------------------------
export default function runSvgSprite({ server = null } = {}) {
  if (server) {
    const dirs = [globalSrc];

    if (fs.existsSync(modulesDir)) {
      fs.readdirSync(modulesDir).forEach((mod) => {
        const dir = path.join(
            modulesDir,
            mod,
            "images",
            "sprite-src"
        );
        if (fs.existsSync(dir)) dirs.push(dir);
      });
    }

    dirs.forEach((dir) => server.watcher.add(dir));

    server.watcher.on("all", (_, file) => {
      if (file.endsWith(".svg")) generateSprite(server);
    });
  }

  generateSprite(server);
}
