/*!
 * Cursoflix — servidor de pré-visualização da interface (somente desenvolvimento).
 * Copyright (c) 2026 Gabriel. Todos os direitos reservados. Veja LICENSE.
 *
 * Uso: npm run preview  →  http://localhost:4317
 * Abre a interface no navegador com dados de exemplo (dev/mock-api.js).
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 4317;
const ALLOWED = ["index.html", "style.css", "renderer.js", "img", "vendor", "themes", "dev", "pdfjs"];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch (error) {
      send(res, 400, "URL inválida");
      return;
    }
    if (pathname === "/") pathname = "/index.html";

    const filePath = path.resolve(ROOT, `.${pathname}`);
    const relative = path.relative(ROOT, filePath);
    const top = relative.split(path.sep)[0];
    if (relative.startsWith("..") || !ALLOWED.includes(top)) {
      send(res, 404, "Não encontrado");
      return;
    }

    const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && fs.existsSync(filePath)) {
      // Vídeos precisam de Range para permitir avançar e voltar.
      const size = fs.statSync(filePath).size;
      const start = range[1] ? parseInt(range[1], 10) : Math.max(0, size - parseInt(range[2], 10));
      const end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        send(res, 404, "Não encontrado");
        return;
      }
      if (relative === "index.html") {
        const html = data
          .toString("utf8")
          .replace('<script src="renderer.js"></script>', '<script src="dev/mock-api.js"></script>\n    <script src="renderer.js"></script>');
        send(res, 200, html, type);
        return;
      }
      send(res, 200, data, type);
    });
  })
  .listen(PORT, () => {
    console.log(`Pré-visualização do Cursoflix em http://localhost:${PORT}`);
  });
