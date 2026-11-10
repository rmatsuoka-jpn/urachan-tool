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
vm.runInNewContext(source + "\nglobalThis.testsApi = {validateShared,validatePersonal,validateBackup,createBackup,upsertShared,entries,visibleEntries,isSharedEnabled,setSharedEnabled,removeSharedSet,yearToJapanese,japaneseToYear,calculateDate,getState:()=>state,setState:(v)=>{state=v}};", context);
const api = context.testsApi;
const shared = {
  format: "urachan-shared", version: 1,
  set: { id: "dept-a", name: "共通サンプル", items: [{ id: "thankyou", title: "お礼", text: "ありがとうございます。" }] }
};
const baseState = () => ({
  version: 2, visibleModules: ["templates"], developerEnabled: false, sharedPreferences: [],
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

test("組織共通タブと「とじる」操作が実装されている", () => {
  assert.match(source, /\["shared", "組織共通"\]/);
  assert.match(source, /サイドパネルをとじる/);
});
test("閉じる処理は新しいChromeのAPIと従来の代替方式に対応する", async () => {
  let closedWindowId = null;
  context.chrome.sidePanel = { close: async ({ windowId }) => { closedWindowId = windowId; } };
  context.chrome.windows = { getCurrent: async () => ({ id: 22 }) };
  context.window = { close: () => { throw new Error("unexpected fallback"); } };
  await vm.runInNewContext("closeSidePanel()", context);
  assert.equal(closedWindowId, 22);

  delete context.chrome.sidePanel;
  let fallback = false;
  context.window = { close: () => { fallback = true; } };
  await vm.runInNewContext("closeSidePanel()", context);
  assert.equal(fallback, true);
});

test("元号変換は境界年を正しく表示", () => {
  assert.equal(api.yearToJapanese("2026"), "令和8年");
  assert.equal(api.yearToJapanese("2019"), "令和元年 / 平成31年");
  assert.equal(api.yearToJapanese("1989"), "平成元年 / 昭和64年");
  assert.equal(api.yearToJapanese("1926"), "昭和元年 / 大正15年");
  assert.equal(api.yearToJapanese(""), "—");
  assert.equal(api.japaneseToYear("令和", "8"), "2026年");
  assert.equal(api.japaneseToYear("平成", "31"), "2019年");
  assert.equal(api.japaneseToYear("平成", "40"), "対象外");
});
test("日付加減算は月末、うるう日と曜日を正しく計算", () => {
  assert.equal(api.calculateDate("2024-02-28", "1").date, "2024/02/29");
  assert.equal(api.calculateDate("2024-02-28", "1").weekday, "木");
  assert.equal(api.calculateDate("2024-03-01", "-1").date, "2024/02/29");
  assert.equal(api.calculateDate("2026-02-30", "1"), null);
  assert.equal(api.calculateDate("2026-01-01", "abc"), null);
});
test("無効な共通セットは全定型文タブから除外し再有効化できる", () => {
  api.setState(baseState());
  api.setSharedEnabled("dept-a", false);
  assert.equal(api.getState().sharedSets.length, 1);
  assert.equal(api.getState().favoriteKeys.includes("s:dept-a:thankyou"), true);
  assert.equal(api.entries().length, 1);
  api.setSharedEnabled("dept-a", true);
  assert.equal(api.entries().length, 3);
});
test("無効セットの再取り込みでも無効を保持", () => {
  api.setState(baseState());
  api.setSharedEnabled("dept-a", false);
  api.upsertShared(api.validateShared(shared));
  assert.equal(api.isSharedEnabled("dept-a"), false);
  assert.equal(api.entries().length, 1);
});
test("セット削除は個人文を保持し共通のお気に入りだけ削除", () => {
  api.setState(baseState());
  api.removeSharedSet("dept-a");
  assert.equal(api.getState().sharedSets.length, 0);
  assert.equal(api.getState().personal.length, 1);
  assert.equal(api.getState().favoriteKeys.join(","), "p:p1");
});
test("バックアップは共通本文を除外し表示設定を保存", () => {
  const data = baseState();
  data.visibleModules = ["templates", "dates"];
  data.sharedPreferences = [{ id: "dept-a", enabled: false }];
  api.setState(data);
  const json = JSON.parse(JSON.stringify(api.createBackup()));
  assert.equal(json.modules.settings.visibleModules.length, 2);
  assert.equal(json.modules.sharedPreferences[0].enabled, false);
  assert.equal(JSON.stringify(json).includes("以前の内容"), false);
  const restored = api.validateBackup(json);
  assert.equal(restored.personal[0].text, "個人の内容");
  assert.equal(restored.visibleModules.includes("dates"), true);
});
test("不正なバックアップは拒否", () => {
  assert.throws(() => api.validateBackup({ format: "urachan-personal", version: 1 }));
  const backup = JSON.parse(JSON.stringify(api.createBackup()));
  backup.modules.settings.visibleModules = ["templates", "unknown"];
  assert.throws(() => api.validateBackup(backup));
});
test("表示機能選択制かつ重複のデータ管理タブを廃止", () => {
  assert.match(source, /function renderFeatureSettings/);
  assert.match(source, /function renderSharedManager/);
  assert.doesNotMatch(source, /btn\("データ管理"/);
});
