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
  URL,
  console,
  setTimeout,
  clearTimeout,
  crypto: { randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" }
};
vm.runInNewContext(source + "\nglobalThis.testsApi = {validateShared,validatePersonal,validateBackup,createBackup,upsertShared,entries,visibleEntries,isSharedEnabled,setSharedEnabled,removeSharedSet,yearToJapanese,japaneseToYear,calculateDate,normalizeBookmarkUrl,validateBookmarkData,bookmarkDataSnapshot,storeBookmark,toggleBookmarkTag,addBookmarkTagDefinition,allBookmarkTags,visibleBookmarks,getActivePage,openSavedBookmark,renameBookmarkTag,deleteBookmarkTag,bookmarkTagUsage,toggleBookmarkFavorite,bookmarkDateMatches,formatBookmarkTimestamp,getState:()=>state,setState:(v)=>{state=v},setBookmarkFilter:(v)=>{bookmarkTagFilter=v},setBookmarkQuery:(v)=>{bookmarkQuery=v},setBookmarkFavoriteOnly:(v)=>{bookmarkFavoriteOnly=v},setBookmarkDateFilter:(v)=>{bookmarkDateFilter=v},setBookmarkDateRange:(from,to)=>{bookmarkDateFrom=from;bookmarkDateTo=to},setBookmarkSort:(v)=>{bookmarkSort=v},setBookmarkShownCount:(v)=>{bookmarkShownCount=v},getBookmarkShownCount:()=>bookmarkShownCount};", context);
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
  favoriteKeys: ["p:p1", "s:dept-a:thankyou", "s:dept-a:removed"],
  bookmarks: [],
  bookmarkPresets: [{ id: "mail", label: "メール", tags: ["メール"] },
    { id: "web", label: "Web", tags: ["Web"] }],
  bookmarkTags: ["メール", "Web"]
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


test("配布アイコン・拡張設定・簡素化したヘッダーを検証", () => {
  const manifest = JSON.parse(readFileSync(path.join(here, "..", "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.6.2");
  for (const size of [16, 32, 48, 128]) {
    const name = `icon${size}.png`;
    assert.equal(manifest.icons[String(size)], name);
    assert.equal(manifest.action.default_icon[String(size)], name);
    const image = readFileSync(path.join(here, "..", name));
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(image.readUInt32BE(16), size);
    assert.equal(image.readUInt32BE(20), size);
  }
  const header = source.split("function renderHeader() {")[1].split("function renderList(")[0];
  assert.doesNotMatch(header, /brand-icon|うらちゃんツール/);
  assert.match(header, /icon-only-button/);
  assert.match(header, /title: "設定", "aria-label": "設定"/);
  assert.match(header, /"× とじる"/);
  assert.match(header, /feature-nav-prev/);
  assert.match(header, /feature-nav-next/);
});

test("保存URLはhttp/httpsだけを許可し認証情報を含むURLを拒否", () => {
  assert.equal(api.normalizeBookmarkUrl("http://intranet.local/mail?id=10"),
    "http://intranet.local/mail?id=10");
  assert.throws(() => api.normalizeBookmarkUrl("file:///c:/test.html"));
  assert.throws(() => api.normalizeBookmarkUrl("javascript:alert(1)"));
  assert.throws(() => api.normalizeBookmarkUrl("https://user:pass@intranet.local/mail"));
  assert.throws(() => api.normalizeBookmarkUrl("not a URL"));
});
test("ワンクリック保存とURL重複時のタグ追加", () => {
  api.setState(baseState());
  const a = api.storeBookmark("https://garoon.local/mail?mid=103", "会議連絡", ["メール"]);
  assert.equal(a.added, true);
  const b = api.storeBookmark("https://garoon.local/mail?mid=103", "別タイトル", ["確認待ち","メール"]);
  assert.equal(b.added, false);
  assert.equal(b.newTags, 1);
  const items = api.getState().bookmarks;
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "会議連絡");
  assert.equal(items[0].tags.join(","), "メール,確認待ち");
});
test("保存済みページのタグを追加・解除して絞り込める", () => {
  api.setState(baseState());
  api.setBookmarkFilter("all"); api.setBookmarkQuery("");
  api.storeBookmark("https://garoon.local/message?mid=5", "会議資料", ["メール"]);
  const item = api.getState().bookmarks[0];
  const custom = api.addBookmarkTagDefinition("確認待ち");
  api.toggleBookmarkTag(item.id, custom);
  api.setBookmarkFilter("tag:確認待ち");
  assert.equal(api.visibleBookmarks().length, 1);
  api.toggleBookmarkTag(item.id, "確認待ち");
  assert.equal(api.visibleBookmarks().length, 0);
  api.setBookmarkFilter("untagged");
  assert.equal(api.visibleBookmarks().length, 0);
  api.toggleBookmarkTag(item.id, "メール");
  assert.equal(api.visibleBookmarks().length, 1);
  api.setBookmarkFilter("all"); api.setBookmarkQuery("会議");
  assert.equal(api.visibleBookmarks().length, 1);
  api.setBookmarkQuery("");
});
test("ブックマークの検証で重複URLや不正タグを拒否", () => {
  api.setState(baseState());
  api.storeBookmark("https://garoon.local/mail/20", "サンプル", ["メール"]);
  const raw = JSON.parse(JSON.stringify(api.bookmarkDataSnapshot()));
  assert.equal(api.validateBookmarkData(raw).items.length, 1);
  raw.items.push({ ...raw.items[0], id: "different-id" });
  assert.throws(() => api.validateBookmarkData(raw));
  raw.items.pop();
  raw.items[0].tags = ["メール", "メール"];
  assert.throws(() => api.validateBookmarkData(raw));
});
test("バックアップに保存済みページと保存ボタン・タグ設定を含める", () => {
  api.setState(baseState());
  api.storeBookmark("https://garoon.local/mail?mid=55", "通達", ["メール"]);
  api.getState().visibleModules = ["templates","bookmarks"];
  api.getState().bookmarkPresets.push({
    id: "check", label: "あとで確認", tags: ["メール", "確認待ち"]
  });
  const backup = JSON.parse(JSON.stringify(api.createBackup()));
  assert.equal(backup.modules.bookmarks.items.length, 1);
  assert.equal(backup.modules.bookmarks.presets.length, 3);
  assert.equal(backup.modules.settings.visibleModules.includes("bookmarks"), true);
  const validated = api.validateBackup(backup);
  assert.equal(validated.bookmarks.items[0].title, "通達");
  assert.equal(validated.bookmarks.presets[2].tags[1], "確認待ち");
  delete backup.modules.bookmarks;
  assert.equal(api.validateBackup(backup).bookmarks, null);
});
test("選択中タブのタイトル・URLだけを取得して新タブで開く", async () => {
  let queryArgs, opened;
  context.chrome.tabs = {
    query: async (args) => {
      queryArgs = args;
      return [{ title: "朝のあいさつ音源の送付について",
        url: "http://garoon.local/cgi-bin/cbgrn/grn.exe/mail?mid=99" }];
    },
    create: async (args) => { opened = args; }
  };
  const page = await api.getActivePage();
  assert.equal(page.title, "朝のあいさつ音源の送付について");
  assert.equal(queryArgs.active, true);
  assert.equal(queryArgs.lastFocusedWindow, true);
  await api.openSavedBookmark(page.url);
  assert.equal(opened.active, true);
  assert.equal(opened.url, page.url);
});
test("設定詳細画面のTOPボタンと編集画面の導線がある", () => {
  assert.match(source, /TOPに戻る/);
  assert.match(source, /function renderBookmarkPresetEditor/);
  assert.match(source, /function renderBookmarkRows/);
  assert.match(source, /function renderBookmarks/);
  const manifest = JSON.parse(readFileSync(path.join(here, "..", "manifest.json"), "utf8"));
  assert.equal(manifest.permissions.includes("tabs"), true);
  assert.equal(manifest.host_permissions, undefined);
});

test("★お気に入りの登録・解除と絞り込み", () => {
  api.setState(baseState());
  api.setBookmarkFavoriteOnly(false);
  api.setBookmarkDateFilter("all");
  api.setBookmarkFilter("all");
  api.setBookmarkQuery("");
  api.setBookmarkSort("new");
  api.storeBookmark("https://grn.local/mail/1", "依頼", ["メール"]);
  api.storeBookmark("https://grn.local/mail/2", "会議", ["メール"]);
  const first = api.getState().bookmarks[0];
  assert.equal(first.favorite, false);
  assert.equal(api.toggleBookmarkFavorite(first.id), true);
  api.setBookmarkFavoriteOnly(true);
  assert.equal(api.visibleBookmarks().length, 1);
  assert.equal(api.visibleBookmarks()[0].title, "会議");
  assert.equal(api.toggleBookmarkFavorite(first.id), false);
  assert.equal(api.visibleBookmarks().length, 0);
  api.setBookmarkFavoriteOnly(false);
});
test("ブックマーク保存日の今日・7日・30日・期間指定を判定", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  api.setBookmarkDateFilter("today");
  assert.equal(api.bookmarkDateMatches("2026-11-10T08:30:00.000Z", now), true);
  assert.equal(api.bookmarkDateMatches("2026-11-09T12:00:00.000Z", now), false);
  api.setBookmarkDateFilter("7");
  assert.equal(api.bookmarkDateMatches("2026-11-04T12:00:00.000Z", now), true);
  assert.equal(api.bookmarkDateMatches("2026-11-03T12:00:00.000Z", now), false);
  api.setBookmarkDateFilter("30");
  assert.equal(api.bookmarkDateMatches("2026-10-12T12:00:00.000Z", now), true);
  assert.equal(api.bookmarkDateMatches("2026-10-11T12:00:00.000Z", now), false);
  api.setBookmarkDateFilter("range");
  api.setBookmarkDateRange("2026-11-05", "2026-11-07");
  assert.equal(api.bookmarkDateMatches("2026-11-07T12:00:00.000Z", now), true);
  assert.equal(api.bookmarkDateMatches("2026-11-08T12:00:00.000Z", now), false);
  api.setBookmarkDateRange("2026-11-05", "");
  assert.equal(api.bookmarkDateMatches("2026-11-10T12:00:00.000Z", now), true);
  api.setBookmarkDateFilter("all");
});
test("お気に入り優先・タイトル順・古い順・新しい順の並び替え", () => {
  api.setState(baseState());
  api.setBookmarkFavoriteOnly(false); api.setBookmarkFilter("all");
  api.setBookmarkQuery(""); api.setBookmarkDateFilter("all");
  const bookmarks = api.getState().bookmarks;
  bookmarks.push({id:"a",title:"りんご",url:"https://a.local/a",tags:["Web"],
    savedAt:"2026-11-01T12:00:00.000Z",favorite:true});
  bookmarks.push({id:"b",title:"あさ",url:"https://a.local/b",tags:["Web"],
    savedAt:"2026-11-09T12:00:00.000Z",favorite:false});
  bookmarks.push({id:"c",title:"やま",url:"https://a.local/c",tags:["Web"],
    savedAt:"2026-11-05T12:00:00.000Z",favorite:true});
  api.setBookmarkSort("favorite");
  assert.equal(api.visibleBookmarks().map(x=>x.id).join(","),"c,a,b");
  api.setBookmarkSort("title");
  assert.equal(api.visibleBookmarks().map(x=>x.id).join(","),"b,c,a");
  api.setBookmarkSort("old");
  assert.equal(api.visibleBookmarks().map(x=>x.id).join(","),"a,c,b");
  api.setBookmarkSort("new");
  assert.equal(api.visibleBookmarks().map(x=>x.id).join(","),"b,c,a");
});
test("タグ名の一括変更と既存タグへの統合が保存ページ・保存ボタンに反映", () => {
  api.setState(baseState());
  api.setBookmarkFilter("tag:メール");
  api.storeBookmark("https://garoon.local/mail/88", "資料送付", ["メール","Web"]);
  assert.equal(api.bookmarkTagUsage("メール"), 1);
  assert.equal(api.renameBookmarkTag("メール","事務連絡"), true);
  assert.equal(api.getState().bookmarks[0].tags.includes("事務連絡"), true);
  assert.equal(api.getState().bookmarkPresets[0].tags[0], "事務連絡");
  assert.equal(api.visibleBookmarks().length, 1);
  assert.equal(api.renameBookmarkTag("事務連絡","Web"), true);
  assert.equal(api.getState().bookmarks[0].tags.join(","), "Web");
  assert.equal(api.getState().bookmarkPresets[0].tags.join(","), "Web");
  assert.equal(api.getState().bookmarkTags.join(","), "Web");
  api.setBookmarkFilter("all");
});
test("タグ削除でブックマーク本体は残し、単独タグ保存ボタンは保護", () => {
  api.setState(baseState());
  api.setBookmarkFilter("tag:メール");
  api.storeBookmark("https://garoon.local/mail/90", "質問", ["メール"]);
  assert.throws(() => api.deleteBookmarkTag("メール"), /保存ボタン/);
  api.getState().bookmarkPresets[0].tags.push("Web");
  assert.equal(api.deleteBookmarkTag("メール"), 1);
  assert.equal(api.getState().bookmarks.length, 1);
  assert.equal(api.getState().bookmarks[0].tags.length, 0);
  assert.equal(api.getState().bookmarkPresets[0].tags.join(","), "Web");
  assert.equal(api.visibleBookmarks().length, 1);
  api.setBookmarkFilter("all");
});
test("お気に入り情報もバックアップに含まれ、型を検証", () => {
  api.setState(baseState());
  api.storeBookmark("https://garoon.local/mail/91", "件名", ["メール"]);
  const item = api.getState().bookmarks[0];
  api.toggleBookmarkFavorite(item.id);
  const backup = JSON.parse(JSON.stringify(api.createBackup()));
  assert.equal(api.validateBackup(backup).bookmarks.items[0].favorite, true);
  backup.modules.bookmarks.items[0].favorite = "true";
  assert.throws(() => api.validateBackup(backup), /お気に入り/);
});
test("一覧は初期5件・もっと表示する5件単位、クリック領域、メニューを備える", () => {
  assert.match(source, /bookmarkShownCount = 5/);
  assert.match(source, /matches\.slice\(0, bookmarkShownCount\)/);
  assert.match(source, /bookmarkShownCount \+= 5/);
  assert.match(source, /"bookmark-open"/);
  assert.match(source, /"bookmark-item-menu"/);
  assert.match(source, /"bookmark-filter-row"/);
  assert.match(source, /"URLをコピー"/);
  assert.match(source, /"✓ 保存済み"/);
  assert.match(source, /"bookmark-tags"\) renderBookmarkTags/);
});


test("数値計算モジュールは任意表示・最近使った種類のみバックアップ", () => {
  const state = api.getState();
  state.calculationRecent = ["travel-estimate", "ratio"];
  const backup = api.createBackup();
  assert.deepEqual(JSON.parse(JSON.stringify(backup.modules.calculations.recent)), ["travel-estimate", "ratio"]);
  assert.equal(JSON.stringify(backup).includes("64000"), false);
  const legacy = structuredClone(backup);
  delete legacy.modules.calculations;
  assert.equal(api.validateBackup(legacy).calculationRecent, null);
  assert.equal(api.validateBackup(backup).calculationRecent.length, 2);
  backup.modules.calculations.recent = ["unknown"];
  assert.throws(() => api.validateBackup(backup));
});
