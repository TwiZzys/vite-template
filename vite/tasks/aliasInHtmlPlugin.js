export function aliasInHtmlPlugin(aliases) {
  return {
    name: "alias-in-html",
    transformIndexHtml(html) {
      let processedHtml = html;

      Object.keys(aliases).forEach((alias) => {
        const cleanPath = alias.replace("@", "/");

        // Створюємо розумнішу регулярку:
        // (?<=["']) — перевірка, що перед аліасом є лапка (одинарна або подвійна)
        // ${alias} — сам аліас
        // (?=["']) — перевірка, що після нього (десь далі) теж є лапка
        const regex = new RegExp(`(?<=["'])${alias}`, "g");

        processedHtml = processedHtml.replace(regex, cleanPath);
      });

      return processedHtml;
    },
  };
}
