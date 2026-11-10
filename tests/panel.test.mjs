// 実行方法: node --test tests/panel.test.mjs
// Chrome専用のUIを開かず、JSON・状態管理の主要ルールを検証します。
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "..", "panel.js"), "utf8")
  .replace(/start\(\);\s*$/, "");
const context = {
  document: { getElementById: () => ({}) },
  chrome: { storage: { local: { set: async () => {} } } },
  structuredClone,
  console,
  setTimeout,
  clearTimeout,
  crypto: { randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" }
};
vm.runInNewContext(source + "\nglobalThis.testsApi = {validateShared,validatePersonal,upsertShared,entries,visibleEntries,getState:()=>state,setState:(v)=>{state=v}};", context);
const api = context.testsApi;
const shared = {
  format: "urachan-shared", version: 1,
  set: { id: "dept-a", name: "共通サンプル", items: [{ id: "thankyou", title: "お礼", text: "ありがとうございます。" }] }
};
const baseState = () => ({
  version: 1, displayMode: "simple", developerEnabled: false,
  personal: [{ id: "p1", title: "個人", text: "個人の内容" }],
  sharedSets: [{
    id: "dept-a", name: "更新前",
    items: [
      { id: "thankyou", title: "旧文", text: "以前の内容" },
      { id: "removed", title: "削除対象", text: "消える" }
    ]
  }],
  favoriteKeys: ["p:p1", "s:dept-a:thankyou", "s:dept-a:removed"]
});

test("共通JSONを正しく読み取る", () => {
  const result = api.validateShared(shared);
  assert.equal(result.id, "dept-a");
  assert.equal(result.items[0].title, "お礼");
});
test("異なるファイル形式は拒否", () => {
  assert.throws(() => api.validateShared({ format: "urachan-personal", version: 1 }));
});
test("共通JSONの重複IDを拒否", () => {
  const duplicate = structuredClone(shared);
  duplicate.set.items.push(structuredClone(duplicate.set.items[0]));
  assert.throws(() => api.validateShared(duplicate));
});
test("不正な文字列形式を拒否", () => {
  const invalid = structuredClone(shared);
  invalid.set.items[0].text = "";
  assert.throws(() => api.validateShared(invalid));
});
test("個人バックアップを検証", () => {
  const valid = api.validatePersonal({
    format: "urachan-personal", version: 1, personal: [], favoriteKeys: ["p:123"]
  });
  assert.equal(valid.personal.length, 0);
  assert.equal(valid.favoriteKeys[0], "p:123");
  assert.throws(() => api.validatePersonal({ format: "urachan-shared", version: 1 }));
});
test("共通セット再取り込みで個人用とお気に入りが維持される", () => {
  api.setState(baseState());
  api.upsertShared(api.validateShared(shared));
  const state = api.getState();
  assert.equal(state.personal.length, 1);
  assert.equal(state.personal[0].text, "個人の内容");
  assert.equal(state.sharedSets.length, 1);
  assert.equal(state.sharedSets[0].items[0].text, "ありがとうございます。");
  assert.equal(state.favoriteKeys.includes("p:p1"), true);
  assert.equal(state.favoriteKeys.includes("s:dept-a:thankyou"), true);
  assert.equal(state.favoriteKeys.includes("s:dept-a:removed"), false);
});
test("共通と個人の一覧を統合できる", () => {
  api.setState(baseState());
  assert.equal(api.entries().length, 3);
});
