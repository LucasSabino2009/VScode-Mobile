import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const exec = promisify(execFile);
const root = resolve(".");

async function jsFiles(dir = resolve(root, "js")) {
  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => resolve(dir, entry.name));
}

test("todos os módulos JS passam pela checagem de sintaxe do Node", async () => {
  for (const file of await jsFiles()) {
    await exec(process.execPath, ["--check", file]);
  }
});

test("index.html referencia os módulos principais existentes", async () => {
  const html = await readFile(resolve(root, "index.html"), "utf8");
  for (const name of ["main.js", "style.css", "jszip.min.js"]) {
    assert.ok(html.includes(name), `referência ausente: ${name}`);
  }
});

test("package.json tem modo ESM e script de teste", async () => {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts?.test, "node --test tests/*.test.js");
});

test("preview preserva script type=module e conecta imports locais", async () => {
  const { buildPreviewDoc, releasePreviewUrls } = await import("../js/preview.js");
  const nodes = [
    { id: "p1", type: "file", name: "index.html", parentId: null, ext: "html", content: '<!doctype html><html><body><script type="module" src="js/main.js"></script></body></html>' },
    { id: "p2", type: "folder", name: "js", parentId: null },
    { id: "p3", type: "file", name: "main.js", parentId: "p2", ext: "js", content: 'import { run } from "./app.js"; run();' },
    { id: "p4", type: "file", name: "app.js", parentId: "p2", ext: "js", content: 'export function run(){ console.log("ok"); }' },
  ];
  const result = await buildPreviewDoc(nodes);
  assert.match(result.doc, /<script type="module" src="blob:[^"]+"/);
  assert.ok(result.blobUrls.length >= 2);
  releasePreviewUrls(result.blobUrls);
});


test("preview incorpora CSS local no documento e resolve assets CSS", async () => {
  const { buildPreviewDoc, releasePreviewUrls } = await import("../js/preview.js");
  const nodes = [
    { id: "h1", type: "file", name: "index.html", parentId: null, ext: "html", content: '<!doctype html><html><head><link rel="stylesheet" href="css/style.css"></head><body><div class="app">ok</div></body></html>' },
    { id: "c1", type: "folder", name: "css", parentId: null },
    { id: "c2", type: "file", name: "style.css", parentId: "c1", ext: "css", content: '.app{background:url("../img/icon.svg"); color:red;} @import "theme.css";' },
    { id: "c3", type: "file", name: "theme.css", parentId: "c1", ext: "css", content: '.app{font-weight:bold;}' },
    { id: "i1", type: "folder", name: "img", parentId: null },
    { id: "i2", type: "file", name: "icon.svg", parentId: "i1", ext: "svg", content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  ];
  const result = await buildPreviewDoc(nodes);
  assert.match(result.doc, /<style data-preview-css="css\/style\.css">/);
  assert.match(result.doc, /data:text\/css/);
  assert.match(result.doc, /data:image\/svg\+xml/);
  assert.match(result.doc, /font-weight%3Abold/);
  releasePreviewUrls(result.blobUrls);
});
