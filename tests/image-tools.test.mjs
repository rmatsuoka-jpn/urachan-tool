// 実行方法: node --test tests/image-tools.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const base = join(dirname(fileURLToPath(import.meta.url)), "..");
const code = readFileSync(join(base, "image-tools.js"), "utf8");
const sandbox = { window: {}, document: {}, chrome: {}, URL, setTimeout, console };
vm.runInNewContext(code, sandbox);
const { isImage, longSideSize, cleanStem, uniqueFilename } = sandbox.window.UraImageTools.helpers;
const mock = (name, size=1000, type="") => ({ name, size, type });

test("JPEG・PNG・HEIC/HEIFだけを受け入れる", () => {
  assert.equal(isImage(mock("photo.HEIC", 2000, "image/heic")), true);
  assert.equal(isImage(mock("photo.heif", 2000)), true);
  assert.equal(isImage(mock("photo.jpeg", 2000, "image/jpeg")), true);
  assert.equal(isImage(mock("photo.png", 2000, "image/png")), true);
  assert.equal(isImage(mock("text.txt", 20, "text/plain")), false);
  assert.equal(isImage(mock("photo.jpg", 0)), false);
  assert.equal(isImage(mock("photo.jpg", 2000, "text/html")), false);
});

test("サイズ変更で縦横比を維持し、拡大しない", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(longSideSize(4000, 3000, "1600"))),
    { width: 1600, height: 1200 });
  assert.deepEqual(JSON.parse(JSON.stringify(longSideSize(3000, 4000, "800"))),
    { width: 600, height: 800 });
  assert.deepEqual(JSON.parse(JSON.stringify(longSideSize(500, 250, "1600"))),
    { width: 500, height: 250 });
  assert.deepEqual(JSON.parse(JSON.stringify(longSideSize(4000, 3000, "original"))),
    { width: 4000, height: 3000 });
});

test("危険なファイル名を整形して、重複名は連番を付ける", () => {
  assert.equal(cleanStem("../test:photo.HEIC"), "_test_photo");
  const set = new Set();
  assert.equal(uniqueFilename("IMG_01.HEIC", "jpg", set), "IMG_01.jpg");
  assert.equal(uniqueFilename("IMG_01.PNG", "jpg", set), "IMG_01-2.jpg");
  assert.equal(uniqueFilename("IMG_01.jpg", "jpg", set), "IMG_01-3.jpg");
});

test("画像変換は独立ファイルとして登録され、余分なChrome権限を要求しない", () => {
  const manifest = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
  const html = readFileSync(join(base, "panel.html"), "utf8");
  const panel = readFileSync(join(base, "panel.js"), "utf8");
  assert.equal(manifest.version, "0.6.1");
  assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
  assert.equal(manifest.host_permissions, undefined);
  assert.ok(!manifest.permissions.includes("downloads"));
  assert.match(html, /image-tools\.js/);
  assert.match(panel, /\{ id: "images", name: "画像変換"/);
  assert.match(panel, /UraImageTools\.render/);
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.ok(statSync(join(base, "vendor", "heic", "libheif-bundle.mjs")).size > 1000000);
  assert.ok(statSync(join(base, "vendor", "jszip", "jszip.min.js")).size > 50000);
  for (const file of [
    "LICENSE", "THIRD_PARTY_NOTICES.md", "vendor/heic/LICENSE",
    "vendor/heic/GPL-3.0.txt", "vendor/jszip/LICENSE-MIT.txt"
  ]) assert.ok(statSync(join(base, file)).size > 100);
});

test("画像変換ライブラリは外部通信に依存せず、単独ダウンロードとZIPを切り替える", () => {
  assert.match(code, /result\.length === 1/);
  assert.match(code, /result\.length > 1/);
  assert.match(code, /compression: "STORE"/);
  assert.match(code, /createImageBitmap/);
  assert.match(code, /getHeif/);
  assert.match(code, /canvas\.toBlob/);
});
