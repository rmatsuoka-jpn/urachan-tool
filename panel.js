"use strict";

const STORAGE_KEY = "urachanAppStateV2";
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ITEMS = 500;
const MAX_BOOKMARKS = 1500;
const MAX_PRESETS = 30;
const MAX_TAGS = 120;
const MAX_TAG_LENGTH = 32;
const MAX_TITLE = 80;
const MAX_TEXT = 10000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const TAB_NAMES = [
  ["all", "すべて"],
  ["favorites", "★ お気に入り"],
  ["personal", "個人"],
  ["shared", "組織共通"]
];
const FEATURES = [
  { id: "templates", name: "定型文", description: "登録した文章をワンクリックコピー" },
  { id: "dates", name: "日付ツール", description: "西暦・和暦変換と日付計算" },
  { id: "bookmarks", name: "あとで見る", description: "現在のページを保存し、タグで整理" }
];
const ERAS = [
  { name: "令和", start: 2019, end: null },
  { name: "平成", start: 1989, end: 2019 },
  { name: "昭和", start: 1926, end: 1989 },
  { name: "大正", start: 1912, end: 1926 },
  { name: "明治", start: 1868, end: 1912 }
];
const DEFAULT_BOOKMARK_PRESETS = [
  { id: "mail", label: "メール", tags: ["メール"] },
  { id: "web", label: "Web", tags: ["Web"] }
];
const DEFAULT_BOOKMARK_TAGS = ["メール", "Web"];
const DEFAULT_STATE = {
  version: 2,
  developerEnabled: false,
  visibleModules: ["templates"],
  personal: [],
  sharedSets: [],
  sharedPreferences: [],
  favoriteKeys: [],
  bookmarks: [],
  bookmarkPresets: structuredClone(DEFAULT_BOOKMARK_PRESETS),
  bookmarkTags: [...DEFAULT_BOOKMARK_TAGS]
};

let state = structuredClone(DEFAULT_STATE);
let view = "home";
let activeModule = "templates";
let selectedSharedSetId = null;
let pendingSharedImport = null;
let devApplyLocally = false;
let conversionDirection = "western";
let westernInputYear = String(new Date().getFullYear());
let japaneseInputEra = "令和";
let japaneseInputYear = "8";
let calculationDate = localIsoDate(new Date());
let calculationOffset = "30";
let bookmarkQuery = "";
let bookmarkTagFilter = "all";
let editingBookmarkId = null;
let bookmarkTitleDraft = "";
let bookmarkNewTagDraft = "";
let bookmarkPresetDraft = null;
let bookmarkPresetNewTagDraft = "";
let currentTab = "all";
let queryText = "";
let personalEditing = null;
let personalDraft = null;
let devDraft = null;
let devItemIndex = null;
let devItemDraft = null;
let versionTapCount = 0;
let lastVersionTap = 0;
let saveQueue = Promise.resolve();
let noticeTimer = null;

const app = document.getElementById("app");
const toast = document.getElementById("toast");

function el(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "checked") element.checked = Boolean(value);
    else if (key === "disabled") element.disabled = Boolean(value);
    else if (key === "value") element.value = value;
    else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined) {
      element.setAttribute(key, String(value));
    }
  }
  const parts = Array.isArray(children) ? children : [children];
  for (const part of parts) {
    if (part === null || part === undefined) continue;
    element.append(part instanceof Node ? part : document.createTextNode(String(part)));
  }
  return element;
}
function btn(label, style, onClick, extra = {}) {
  return el("button", { type: "button", class: "button " + style, onClick, ...extra }, label);
}
function text(tag, value, className = "") {
  return el(tag, { class: className, text: value });
}
function row(...children) {
  return el("div", { class: "row" }, children);
}
function field(title, input, help) {
  const wrapper = el("div", { class: "form-field" }, [el("label", {}, title), input]);
  if (help) wrapper.append(text("p", help, "help"));
  return wrapper;
}
function heading(title, subtitle) {
  const parts = [text("h1", title, "page-heading")];
  if (subtitle) parts.push(text("p", subtitle, "explain"));
  return parts;
}
function notify(message, undo) {
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  toast.replaceChildren();
  const contents = row(text("span", message));
  if (undo) contents.append(btn("元に戻す", "", () => {
    undo();
    notify("元に戻しました");
  }));
  toast.append(contents);
  toast.hidden = false;
  noticeTimer = setTimeout(() => { toast.hidden = true; }, undo ? 9000 : 3500);
}
function persist() {
  const snapshot = structuredClone(state);
  saveQueue = saveQueue.catch(() => {}).then(() => chrome.storage.local.set({ [STORAGE_KEY]: snapshot }));
  saveQueue.catch((error) => {
    console.error("データ保存エラー", error);
    notify("保存できませんでした。Chromeの保存設定を確認してください。");
  });
  return saveQueue;
}
function navigate(next) {
  view = next;
  render();
}
function uniqueId() {
  return crypto.randomUUID();
}
function safeName(part) {
  return part.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60) || "data";
}
function normalizeText(value) {
  return value.replace(/\r\n/g, "\n");
}
function isValidItem(item) {
  return Boolean(item && typeof item === "object"
    && typeof item.id === "string" && ID_PATTERN.test(item.id)
    && typeof item.title === "string" && item.title.trim().length > 0 && item.title.length <= MAX_TITLE
    && typeof item.text === "string" && item.text.trim().length > 0 && item.text.length <= MAX_TEXT);
}
function validateItems(items) {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw Error("定型文の件数が多すぎるか、形式が正しくありません。");
  const seen = new Set();
  return items.map((entry) => {
    if (!isValidItem(entry)) throw Error("定型文の項目が正しくありません。名前と文章を確認してください。");
    if (seen.has(entry.id)) throw Error("同じIDの定型文があります。");
    seen.add(entry.id);
    return { id: entry.id, title: entry.title, text: normalizeText(entry.text) };
  });
}
function validateShared(data) {
  if (!data || data.format !== "urachan-shared" || data.version !== 1 || !data.set) {
    throw Error("このファイルは共通定型文として取り込めません。");
  }
  const set = data.set;
  if (typeof set.id !== "string" || !ID_PATTERN.test(set.id)
    || typeof set.name !== "string" || !set.name.trim() || set.name.length > MAX_TITLE) {
    throw Error("共通セットの名前または形式が正しくありません。");
  }
  return { id: set.id, name: set.name, items: validateItems(set.items) };
}
function validatePersonal(data) {
  if (!data || data.format !== "urachan-personal" || data.version !== 1) {
    throw Error("このファイルは個人データのバックアップではありません。");
  }
  const personal = validateItems(data.personal);
  if (!Array.isArray(data.favoriteKeys) || data.favoriteKeys.length > 2500
    || !data.favoriteKeys.every((key) => typeof key === "string" && key.length <= 220
      && /^(p|s):[A-Za-z0-9_:-]+$/.test(key))) {
    throw Error("お気に入り情報が正しくありません。");
  }
  return { personal, favoriteKeys: [...new Set(data.favoriteKeys)] };
}

function normalizeBookmarkUrl(value) {
  if (typeof value !== "string" || value.length > 4096) throw Error("URLが長すぎるか、正しくありません。");
  let parsed;
  try { parsed = new URL(value); } catch { throw Error("有効なURLを取得できませんでした。"); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname
    || parsed.username || parsed.password) {
    throw Error("http・httpsの通常のWebページだけを保存できます。");
  }
  return parsed.href;
}
function validTag(tag) {
  return typeof tag === "string" && tag.trim() === tag
    && tag.length > 0 && tag.length <= MAX_TAG_LENGTH
    && !/[\\x00-\\x1f\\x7f]/.test(tag);
}
function validateBookmarkData(data) {
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.presets)
    || !Array.isArray(data.tags) || data.items.length > MAX_BOOKMARKS
    || data.presets.length > MAX_PRESETS || data.tags.length > MAX_TAGS) {
    throw Error("ブックマークの件数または形式が正しくありません。");
  }
  if (data.tags.some((tag) => !validTag(tag)) || new Set(data.tags).size !== data.tags.length) {
    throw Error("タグの一覧が正しくありません。");
  }
  const usedIds = new Set(), usedUrls = new Set(), usedPresetIds = new Set();
  const items = data.items.map((item) => {
    if (!item || typeof item.id !== "string" || !ID_PATTERN.test(item.id)
      || usedIds.has(item.id)
      || typeof item.title !== "string" || !item.title.trim() || item.title.length > 200
      || !Array.isArray(item.tags) || item.tags.length > MAX_TAGS
      || item.tags.some((tag) => !validTag(tag))
      || new Set(item.tags).size !== item.tags.length
      || typeof item.savedAt !== "string" || !Number.isFinite(Date.parse(item.savedAt))) {
      throw Error("ブックマークの登録内容が正しくありません。");
    }
    const url = normalizeBookmarkUrl(item.url);
    if (usedUrls.has(url)) throw Error("重複したURLが含まれています。");
    usedIds.add(item.id); usedUrls.add(url);
    return { id: item.id, title: item.title, url, tags: [...item.tags], savedAt: item.savedAt };
  });
  const presets = data.presets.map((preset) => {
    if (!preset || typeof preset.id !== "string" || !ID_PATTERN.test(preset.id)
      || usedPresetIds.has(preset.id)
      || typeof preset.label !== "string" || !preset.label.trim() || preset.label.length > 24
      || !Array.isArray(preset.tags) || preset.tags.length === 0 || preset.tags.length > 10
      || preset.tags.some((tag) => !validTag(tag))
      || new Set(preset.tags).size !== preset.tags.length) {
      throw Error("保存ボタンの設定が正しくありません。");
    }
    usedPresetIds.add(preset.id);
    return { id: preset.id, label: preset.label.trim(), tags: [...preset.tags] };
  });
  return { items, presets, tags: [...data.tags] };
}
function bookmarkDataSnapshot() {
  return {
    items: state.bookmarks,
    presets: state.bookmarkPresets,
    tags: state.bookmarkTags
  };
}
function storeBookmark(url, title, presetTags) {
  const normalizedUrl = normalizeBookmarkUrl(url);
  if (typeof title !== "string") throw Error("ページタイトルを取得できませんでした。");
  const cleanTitle = title.trim().slice(0, 200) || normalizedUrl.slice(0, 200);
  if (!Array.isArray(presetTags) || !presetTags.length || presetTags.some((tag) => !validTag(tag))) {
    throw Error("保存ボタンのタグ設定が正しくありません。");
  }
  const existing = state.bookmarks.find((item) => item.url === normalizedUrl);
  if (existing) {
    const oldCount = existing.tags.length;
    existing.tags = [...new Set([...existing.tags, ...presetTags])];
    persist();
    return { added: false, newTags: existing.tags.length - oldCount };
  }
  if (state.bookmarks.length >= MAX_BOOKMARKS) throw Error("保存件数の上限に達しました。");
  state.bookmarks.unshift({
    id: uniqueId(), url: normalizedUrl, title: cleanTitle, tags: [...new Set(presetTags)],
    savedAt: new Date().toISOString()
  });
  persist();
  return { added: true, newTags: presetTags.length };
}
function toggleBookmarkTag(bookmarkId, tag) {
  if (!validTag(tag)) throw Error("タグ名を確認してください。");
  const item = state.bookmarks.find((entry) => entry.id === bookmarkId);
  if (!item) throw Error("対象のブックマークが見つかりません。");
  if (item.tags.includes(tag)) item.tags = item.tags.filter((name) => name !== tag);
  else item.tags.push(tag);
  if (!state.bookmarkTags.includes(tag)) state.bookmarkTags.push(tag);
  persist();
}
function addBookmarkTagDefinition(tag) {
  const value = tag.trim();
  if (!validTag(value)) throw Error("タグ名は1〜32文字で入力してください。");
  if (!state.bookmarkTags.includes(value)) {
    if (state.bookmarkTags.length >= MAX_TAGS) throw Error("タグをこれ以上登録できません。");
    state.bookmarkTags.push(value);
    persist();
  }
  return value;
}
function allBookmarkTags() {
  return [...new Set([...state.bookmarkTags,
    ...state.bookmarks.flatMap((item) => item.tags),
    ...state.bookmarkPresets.flatMap((preset) => preset.tags)])];
}
function visibleBookmarks() {
  const needle = bookmarkQuery.trim().toLocaleLowerCase();
  return [...state.bookmarks]
    .filter((item) => {
      if (bookmarkTagFilter === "untagged" && item.tags.length !== 0) return false;
      if (bookmarkTagFilter.startsWith("tag:") &&
        !item.tags.includes(bookmarkTagFilter.slice(4))) return false;
      return [item.title, item.url, ...item.tags].join(" ").toLocaleLowerCase().includes(needle);
    })
    .sort((a,b) => b.savedAt.localeCompare(a.savedAt));
}
async function getActivePage() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.url !== "string") throw Error("現在のページを取得できませんでした。");
  const url = normalizeBookmarkUrl(tab.url);
  return { url, title: (tab.title || url).trim().slice(0, 200) };
}
async function saveCurrentBookmark(presetId) {
  const preset = state.bookmarkPresets.find((item) => item.id === presetId);
  if (!preset) return notify("保存ボタンが見つかりません。");
  try {
    const page = await getActivePage();
    const result = storeBookmark(page.url, page.title, preset.tags);
    render();
    notify(result.added ? "ページを保存しました。" :
      result.newTags ? "保存済みページにタグを追加しました。" : "すでに保存されています。");
  } catch (error) {
    notify(error.message || "ページを保存できませんでした。");
  }
}
async function openSavedBookmark(url) {
  try {
    await chrome.tabs.create({ url: normalizeBookmarkUrl(url), active: true });
  } catch {
    notify("ページを開けませんでした。ブラウザの設定を確認してください。");
  }
}

function validateBackup(data) {
  if (!data || data.format !== "urachan-backup" || data.version !== 2 || !data.modules) {
    throw Error("このファイルは対応しているバックアップではありません。");
  }
  const templates = data.modules.templates;
  const settings = data.modules.settings;
  const preferences = data.modules.sharedPreferences;
  if (!templates || !settings || !Array.isArray(settings.visibleModules)
    || !Array.isArray(preferences) || preferences.length > MAX_ITEMS
    || settings.visibleModules.length < 1 || settings.visibleModules.length > FEATURES.length
    || !settings.visibleModules.every((id) => FEATURES.some((feature) => feature.id === id))
    || new Set(settings.visibleModules).size !== settings.visibleModules.length) {
    throw Error("バックアップ内の設定が正しくありません。");
  }
  const validated = validatePersonal({
    format: "urachan-personal", version: 1,
    personal: templates.personal, favoriteKeys: templates.favoriteKeys
  });
  if (!preferences.every((pref) =>
    pref && typeof pref.id === "string" && ID_PATTERN.test(pref.id)
    && typeof pref.enabled === "boolean") ||
    new Set(preferences.map((pref) => pref.id)).size !== preferences.length) {
    throw Error("組織共通データの表示設定が正しくありません。");
  }
  const bookmarks = data.modules.bookmarks === undefined
    ? null : validateBookmarkData(data.modules.bookmarks);
  return {
    personal: validated.personal, favoriteKeys: validated.favoriteKeys,
    visibleModules: [...settings.visibleModules],
    sharedPreferences: preferences.map((pref) => ({ id: pref.id, enabled: pref.enabled })),
    bookmarks
  };
}
function createBackup() {
  return {
    format: "urachan-backup", version: 2,
    createdAt: new Date().toISOString(),
    modules: {
      templates: { personal: state.personal, favoriteKeys: state.favoriteKeys },
      sharedPreferences: state.sharedPreferences,
      settings: { visibleModules: state.visibleModules },
      bookmarks: bookmarkDataSnapshot()
    }
  };
}
function exportJson(filename, object) {
  const json = JSON.stringify(object, null, 2) + "\n";
  const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function loadJsonFile(file) {
  if (!file) return null;
  if (file.size > MAX_FILE_BYTES) throw Error("1MB以下のJSONファイルを選んでください。");
  let value;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw Error("JSONファイルを読み取れません。ファイルを確認してください。");
  }
  return value;
}
function attachJsonInput(handler) {
  const input = el("input", { class: "file-input", type: "file", accept: ".json,application/json" });
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      await handler(await loadJsonFile(file));
    } catch (error) {
      notify(error.message || "取り込みに失敗しました。");
    } finally {
      input.value = "";
    }
  });
  return input;
}
function favKey(entry) {
  return entry.source === "personal" ? "p:" + entry.id : "s:" + entry.setId + ":" + entry.id;
}
function isSharedEnabled(setId) {
  const pref = (state.sharedPreferences || []).find((p) => p.id === setId);
  return !pref || pref.enabled !== false;
}
function setSharedEnabled(setId, enabled) {
  state.sharedPreferences = (state.sharedPreferences || []).filter((p) => p.id !== setId);
  state.sharedPreferences.push({ id: setId, enabled: Boolean(enabled) });
  persist();
}
function removeSharedSet(id) {
  state.sharedSets = state.sharedSets.filter((s) => s.id !== id);
  state.sharedPreferences = (state.sharedPreferences || []).filter((p) => p.id !== id);
  state.favoriteKeys = state.favoriteKeys.filter((key) => !key.startsWith("s:" + id + ":"));
  persist();
}
function entries() {
  const personal = state.personal.map((item) => ({ ...item, source: "personal" }));
  const shared = state.sharedSets.filter((set) => isSharedEnabled(set.id)).flatMap((set) =>
    set.items.map((item) => ({ ...item, source: "shared", setId: set.id, setName: set.name }))
  );
  return [...personal, ...shared];
}
function visibleEntries() {
  const needle = queryText.trim().toLocaleLowerCase();
  return entries().filter((entry) => {
    if (currentTab === "personal" && entry.source !== "personal") return false;
    if (currentTab === "shared" && entry.source !== "shared") return false;
    if (currentTab === "favorites" && !state.favoriteKeys.includes(favKey(entry))) return false;
    return (entry.title + " " + entry.text + " " + (entry.setName || "")).toLocaleLowerCase().includes(needle);
  });
}
function toggleFavorite(entry) {
  const key = favKey(entry);
  if (state.favoriteKeys.includes(key)) state.favoriteKeys = state.favoriteKeys.filter((value) => value !== key);
  else state.favoriteKeys.push(key);
  persist();
  render();
}
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    notify("コピーしました。貼り付け先で Ctrl + V を押してください。");
  } catch {
    // 古い端末設定でClipboard APIが使えない場合のフォールバック。
    const input = el("textarea", { "aria-label": "コピー用" });
    input.value = value;
    input.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.append(input);
    input.select();
    const succeeded = document.execCommand("copy");
    input.remove();
    notify(succeeded ? "コピーしました。" : "コピーできませんでした。Chromeのクリップボード設定を確認してください。");
  }
}
function removeOrphanSharedFavorites(setId, items) {
  const remaining = new Set(items.map((item) => "s:" + setId + ":" + item.id));
  state.favoriteKeys = state.favoriteKeys.filter((key) =>
    !key.startsWith("s:" + setId + ":") || remaining.has(key)
  );
}
function upsertShared(set) {
  const index = state.sharedSets.findIndex((candidate) => candidate.id === set.id);
  const incoming = { ...structuredClone(set), importedAt: new Date().toISOString() };
  if (index >= 0) state.sharedSets[index] = incoming;
  else state.sharedSets.push(incoming);
  removeOrphanSharedFavorites(set.id, set.items);
  persist();
}
async function closeSidePanel() {
  // Chrome 141以降は公式APIで閉じ、未対応時はパネル内のwindow.close()を使います。
  try {
    if (typeof chrome.sidePanel?.close === "function"
      && typeof chrome.windows?.getCurrent === "function") {
      const currentWindow = await chrome.windows.getCurrent();
      if (Number.isInteger(currentWindow?.id)) {
        await chrome.sidePanel.close({ windowId: currentWindow.id });
        return;
      }
    }
  } catch (error) {
    console.warn("サイドパネルを閉じるAPIを利用できませんでした。", error);
  }
  window.close();
}

function renderHeader() {
  const header = el("header", { class: "header" });
  const title = row(el("img", { class: "brand-icon", src: "icon32.png", alt: "" }), text("span", "うらちゃんツール", "brand"));
  const backTarget = view === "settings" ? "home"
    : view === "shared-details" ? "shared-manager"
    : view === "personal-editor" || view === "bookmark-presets" ? "home"
    : view === "bookmark-preset-editor" ? "bookmark-presets" : "settings";
  const back = view === "home"
    ? btn("⚙ 設定", "settings-button", () => navigate("settings"))
    : btn("← 戻る", "settings-button", () => navigate(backTarget));
  back.className = "settings-button";
  const close = el("button", {
    type: "button", class: "settings-button close-button",
    title: "サイドパネルをとじる", "aria-label": "サイドパネルをとじる",
    onClick: () => { void closeSidePanel(); }
  }, "× とじる");
  header.append(el("div", { class: "topbar" }, [title,
    el("div", { class: "header-actions" }, [back, close])]));
  if (view === "home") {
    const shown = FEATURES.filter((m) => state.visibleModules.includes(m.id));
    const nav = el("nav", { class: "mode-nav feature-nav", "aria-label": "表示する機能" });
    if (shown.length > 1) {
      shown.forEach((module) => {
        const button = btn(module.name, activeModule === module.id ? "active" : "", () => {
          activeModule = module.id;
          render();
        });
        nav.append(button);
      });
    }
    nav.append(btn("＋ 機能", "feature-add", () => navigate("feature-settings")));
    header.append(nav);
  }
  return header;
}
function renderList(container, count) {
  container.replaceChildren();
  const all = visibleEntries();
  count.textContent = all.length + "件表示";
  if (all.length === 0) {
    const isEmpty = state.personal.length === 0 && state.sharedSets.every((set) => set.items.length === 0);
    const box = el("div", { class: "empty" }, [
      text("strong", isEmpty ? "まだ定型文がありません" : "該当する定型文がありません"),
      text("p", isEmpty ? "「＋ 新しく登録」から始めましょう。" : "検索語やタブを変更してみてください。")
    ]);
    container.append(box);
    return;
  }
  for (const entry of all) {
    const title = el("span", { class: "item-title" }, [
      entry.title,
      entry.source === "shared" ? text("span", "組織共通", "source-tag") : null
    ]);
    const copy = el("button", {
      type: "button",
      class: "item-copy",
      title: entry.title + "をコピー",
      "aria-label": entry.title + "をコピー",
      onClick: () => copyText(entry.text)
    }, [title, text("span", entry.text, "item-preview")]);
    const favorite = state.favoriteKeys.includes(favKey(entry));
    const star = el("button", {
      type: "button",
      class: "icon-button " + (favorite ? "favorite-on" : ""),
      "aria-label": entry.title + (favorite ? "のお気に入りを解除" : "をお気に入りに登録"),
      title: favorite ? "お気に入り解除" : "お気に入り登録",
      onClick: () => toggleFavorite(entry)
    }, favorite ? "★" : "☆");
    const action = el("button", {
      type: "button",
      class: "icon-button action-button",
      title: entry.source === "personal" ? "編集" : "個人用にコピー",
      "aria-label": entry.title + (entry.source === "personal" ? "を編集" : "を個人用にコピー"),
      onClick: () => openPersonalEditor(entry)
    }, entry.source === "personal" ? "編集" : "複製");
    container.append(el("div", { class: "item-row" }, [copy, star, action]));
  }
}
function renderHome(main) {
  if (!state.visibleModules.includes(activeModule)) activeModule = state.visibleModules[0] || "templates";
  if (activeModule === "dates") return renderDateTools(main);
  if (activeModule === "bookmarks") return renderBookmarks(main);
  main.append(...heading("定型文をコピー", "使いたい文章を押すだけでコピーできます。"));
  const search = el("input", {
    type: "search", class: "search", value: queryText,
    placeholder: "名前や文章を検索", "aria-label": "定型文を検索"
  });
  main.append(search);
  const tabs = el("div", { class: "tabs", role: "tablist", "aria-label": "定型文の分類" });
  TAB_NAMES.forEach(([key, label]) => {
    tabs.append(el("button", {
      type: "button", class: currentTab === key ? "active" : "",
      role: "tab", "aria-selected": String(currentTab === key),
      onClick: () => { currentTab = key; render(); }
    }, key === "favorites" ? [text("span", "★", "tab-star"), " お気に入り"] : label));
  });
  main.append(tabs);
  const list = el("div", { class: "list" });
  const count = text("div", "", "counter");
  search.addEventListener("input", () => {
    queryText = search.value;
    renderList(list, count);
  });
  main.append(list, count);
  renderList(list, count);
  main.append(el("div", { class: "footer-action" }, btn("＋ 新しく登録", "button-primary full", () => openPersonalEditor())));
}


function refreshCurrentPagePreview(preview) {
  getActivePage().then((page) => {
    if (preview.isConnected) {
      preview.textContent = page.title;
      preview.title = page.url;
    }
  }).catch((error) => {
    if (preview.isConnected) {
      preview.textContent = error.message || "ページを取得できませんでした。";
      preview.title = "";
    }
  });
}
function bookmarkFilterButtons() {
  const filter = el("div", { class: "bookmark-filters", "aria-label": "タグによる絞り込み" });
  const names = [["all", "すべて"]];
  if (state.bookmarks.some((item) => item.tags.length === 0)) names.push(["untagged", "未整理"]);
  allBookmarkTags().forEach((tag) => names.push(["tag:" + tag, tag]));
  names.forEach(([id, label]) => {
    filter.append(btn(label, bookmarkTagFilter === id ? "active" : "", () => {
      bookmarkTagFilter = id;
      render();
    }));
  });
  return filter;
}
function renderBookmarkRows(container, count) {
  container.replaceChildren();
  const matches = visibleBookmarks();
  count.textContent = matches.length + "件表示";
  if (!matches.length) {
    container.append(el("div", { class: "empty" }, [
      text("strong", state.bookmarks.length ? "該当するページはありません" : "まだ保存したページがありません"),
      text("p", state.bookmarks.length ? "タグや検索語を変えてください。" : "上の保存ボタンから登録できます。")
    ]));
    return;
  }
  matches.forEach((item) => {
    const card = el("section", { class: "bookmark-item" });
    const summary = el("div", { class: "bookmark-item-head" }, [
      el("button", {
        type: "button", class: "bookmark-title",
        title: "新しいタブで開く",
        onClick: () => { void openSavedBookmark(item.url); }
      }, item.title),
      btn(editingBookmarkId === item.id ? "閉じる" : "タグ編集", "button-secondary bookmark-edit-button", () => {
        if (editingBookmarkId === item.id) editingBookmarkId = null;
        else {
          editingBookmarkId = item.id;
          bookmarkTitleDraft = item.title;
          bookmarkNewTagDraft = "";
        }
        renderBookmarkRows(container, count);
      })
    ]);
    card.append(summary);
    const chips = el("div", { class: "bookmark-tags" },
      item.tags.length ? item.tags.map((tag) => text("span", tag, "bookmark-tag")) :
        [text("span", "未整理", "bookmark-tag subtle")]);
    card.append(chips);
    if (editingBookmarkId === item.id) {
      const editor = el("div", { class: "bookmark-inline-editor" }, [
        text("div", "タグを付け外す", "bookmark-subheading")
      ]);
      const tags = el("div", { class: "bookmark-tag-choices" });
      allBookmarkTags().forEach((tag) => {
        const selected = item.tags.includes(tag);
        tags.append(btn((selected ? "✓ " : "＋ ") + tag, selected ? "active" : "", () => {
          try { toggleBookmarkTag(item.id, tag); render(); }
          catch (error) { notify(error.message); }
        }));
      });
      editor.append(tags);
      const input = el("input", {
        type: "text", maxlength: MAX_TAG_LENGTH, value: bookmarkNewTagDraft,
        placeholder: "新しいタグ名", "aria-label": "新しいタグ名",
        onInput: (event) => { bookmarkNewTagDraft = event.target.value; }
      });
      editor.append(el("div", { class: "bookmark-new-tag" }, [
        input,
        btn("＋ 追加", "button-secondary", () => {
          try {
            const tag = addBookmarkTagDefinition(bookmarkNewTagDraft);
            if (!item.tags.includes(tag)) toggleBookmarkTag(item.id, tag);
            bookmarkNewTagDraft = "";
            render();
          } catch (error) { notify(error.message); }
        })
      ]));
      const titleInput = el("input", {
        type: "text", value: bookmarkTitleDraft, maxlength: 200,
        "aria-label": "ブックマークのタイトル",
        onInput: (event) => { bookmarkTitleDraft = event.target.value; }
      });
      editor.append(text("div", "タイトルの変更", "bookmark-subheading"));
      editor.append(el("div", { class: "bookmark-new-tag" }, [
        titleInput,
        btn("変更", "button-secondary", () => {
          const next = bookmarkTitleDraft.trim();
          if (!next) return notify("タイトルを入力してください。");
          item.title = next;
          persist();
          renderBookmarkRows(container, count);
          notify("タイトルを変更しました。");
        })
      ]));
      editor.append(el("div", { class: "bookmark-editor-actions" }, [
        btn("削除", "button-danger", () => {
          if (!confirm("「" + item.title + "」を削除しますか？")) return;
          state.bookmarks = state.bookmarks.filter((entry) => entry.id !== item.id);
          editingBookmarkId = null;
          persist();
          render();
          notify("ブックマークを削除しました。");
        }),
        btn("完了", "button-primary", () => {
          editingBookmarkId = null;
          renderBookmarkRows(container, count);
        })
      ]));
      card.append(editor);
    }
    container.append(card);
  });
}
function renderBookmarks(main) {
  main.append(...heading("あとで見る"));
  const preview = text("div", "現在のページを確認しています…", "bookmark-current-title");
  preview.id = "bookmark-current";
  const saveSection = el("section", { class: "card bookmark-save-card" }, [
    text("div", "現在開いているページ", "bookmark-subheading"),
    preview
  ]);
  const buttons = el("div", { class: "bookmark-save-buttons" });
  state.bookmarkPresets.forEach((preset) => {
    buttons.append(btn("＋ " + preset.label, "button-primary", () => { void saveCurrentBookmark(preset.id); },
      { title: preset.tags.join("、") + " のタグで保存" }));
  });
  saveSection.append(buttons);
  saveSection.append(el("div", { class: "bookmark-save-footer" }, [
    btn("保存ボタンを編集", "button-plain", () => navigate("bookmark-presets")),
    btn("ページ更新", "button-plain", () => refreshCurrentPagePreview(preview))
  ]));
  main.append(saveSection);
  refreshCurrentPagePreview(preview);
  main.append(text("h2", "保存済みページ", "section-title"), bookmarkFilterButtons());
  const search = el("input", {
    type: "search", class: "search", value: bookmarkQuery,
    placeholder: "タイトル・URL・タグで検索", "aria-label": "保存ページを検索"
  });
  const container = el("div", { class: "bookmark-list" });
  const count = text("div", "", "counter");
  search.addEventListener("input", () => {
    bookmarkQuery = search.value;
    renderBookmarkRows(container, count);
  });
  main.append(search, container, count);
  renderBookmarkRows(container, count);
}
function openBookmarkPresetEditor(id) {
  const saved = state.bookmarkPresets.find((preset) => preset.id === id);
  bookmarkPresetDraft = saved ? structuredClone(saved) :
    { id: uniqueId(), label: "", tags: [] };
  bookmarkPresetNewTagDraft = "";
  navigate("bookmark-preset-editor");
}
function renderBookmarkPresets(main) {
  main.append(...heading("保存ボタンの設定", "ボタン名と、押したときに付けるタグを設定します。"));
  main.append(btn("＋ 保存ボタンを追加", "button-primary full", () => openBookmarkPresetEditor(null)));
  if (!state.bookmarkPresets.length) {
    main.append(text("p", "保存ボタンがありません。追加して使ってください。", "help"));
  }
  state.bookmarkPresets.forEach((preset) => {
    main.append(el("section", { class: "card" }, [
      el("div", { class: "bookmark-preset-row" }, [
        el("div", { class: "bookmark-preset-info" }, [
          text("strong", preset.label),
          text("small", "タグ：" + preset.tags.join("、"))
        ]),
        btn("編集", "button-secondary", () => openBookmarkPresetEditor(preset.id))
      ]),
      btn("このボタンを削除", "button-plain bookmark-remove-preset", () => {
        if (!confirm("「" + preset.label + "」の保存ボタンを削除しますか？保存済みページは残ります。")) return;
        state.bookmarkPresets = state.bookmarkPresets.filter((item) => item.id !== preset.id);
        persist();
        render();
      })
    ]));
  });
}
function renderBookmarkPresetEditor(main) {
  if (!bookmarkPresetDraft) return navigate("bookmark-presets");
  main.append(...heading("保存ボタンを編集"));
  const form = el("section", { class: "card" });
  const label = el("input", {
    type: "text", value: bookmarkPresetDraft.label, maxlength: 24,
    placeholder: "例：あとで確認",
    onInput: (ev) => { bookmarkPresetDraft.label = ev.target.value; }
  });
  form.append(field("ボタンに表示する名前", label));
  form.append(text("div", "自動で付けるタグ", "bookmark-subheading"));
  const choices = el("div", { class: "bookmark-tag-choices" });
  allBookmarkTags().forEach((tag) => {
    const selected = bookmarkPresetDraft.tags.includes(tag);
    choices.append(btn((selected ? "✓ " : "＋ ") + tag, selected ? "active" : "", () => {
      if (selected) bookmarkPresetDraft.tags = bookmarkPresetDraft.tags.filter((x) => x !== tag);
      else if (bookmarkPresetDraft.tags.length < 10) bookmarkPresetDraft.tags.push(tag);
      else return notify("1つのボタンには最大10個のタグを設定できます。");
      render();
    }));
  });
  form.append(choices);
  const newTag = el("input", {
    type: "text", value: bookmarkPresetNewTagDraft, maxlength: MAX_TAG_LENGTH,
    placeholder: "新しいタグを作る", "aria-label": "新しいタグを作る",
    onInput: (ev) => { bookmarkPresetNewTagDraft = ev.target.value; }
  });
  form.append(el("div", { class: "bookmark-new-tag" }, [
    newTag,
    btn("＋ 追加", "button-secondary", () => {
      try {
        const tag = addBookmarkTagDefinition(bookmarkPresetNewTagDraft);
        if (!bookmarkPresetDraft.tags.includes(tag)) {
          if (bookmarkPresetDraft.tags.length >= 10) throw Error("ボタンに設定できるタグは10個までです。");
          bookmarkPresetDraft.tags.push(tag);
        }
        bookmarkPresetNewTagDraft = "";
        render();
      } catch (error) { notify(error.message); }
    })
  ]));
  form.append(text("p", "保存時には選択したタグが一度に付きます。すでに保存済みのページには遡って反映されません。", "help"));
  form.append(el("div", { class: "controls" }, [
    btn("キャンセル", "button-secondary", () => navigate("bookmark-presets")),
    btn("保存する", "button-primary", () => {
      const labelText = bookmarkPresetDraft.label.trim();
      if (!labelText || !bookmarkPresetDraft.tags.length) {
        return notify("ボタン名と、1つ以上のタグを選択してください。");
      }
      if (state.bookmarkPresets.some((preset) =>
        preset.id !== bookmarkPresetDraft.id && preset.label === labelText)) {
        return notify("同じ名前の保存ボタンがあります。");
      }
      const next = { id: bookmarkPresetDraft.id, label: labelText,
        tags: [...bookmarkPresetDraft.tags] };
      const index = state.bookmarkPresets.findIndex((item) => item.id === next.id);
      if (index < 0 && state.bookmarkPresets.length >= MAX_PRESETS) {
        return notify("保存ボタンの登録上限は30個です。");
      }
      if (index < 0) state.bookmarkPresets.push(next);
      else state.bookmarkPresets[index] = next;
      persist();
      bookmarkPresetDraft = null;
      navigate("bookmark-presets");
      notify("保存ボタンを設定しました。");
    })
  ]));
  main.append(form);
}

function localIsoDate(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}
function yearToJapanese(value) {
  const year = Number(value);
  if (!/^\d{1,4}$/.test(String(value)) || !Number.isInteger(year) || year < 1) return "—";
  const matches = ERAS.filter((e) => year >= e.start && (e.end === null || year <= e.end));
  return matches.length
    ? matches.map((e) => e.name + (year === e.start ? "元" : String(year - e.start + 1)) + "年").join(" / ")
    : "対象外";
}
function japaneseToYear(eraName, yearText) {
  const selected = ERAS.find((e) => e.name === eraName);
  const n = Number(yearText);
  if (!selected || !/^\d{1,3}$/.test(String(yearText)) || !Number.isInteger(n) || n < 1) return "—";
  const result = selected.start + n - 1;
  if (selected.end !== null && result > selected.end) return "対象外";
  return result + "年";
}
function parseDateInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day) return null;
  return result;
}
function calculateDate(base, offset) {
  const date = parseDateInput(base);
  if (!date || !/^-?\d{1,6}$/.test(String(offset)) || Math.abs(Number(offset)) > 365000) return null;
  date.setUTCDate(date.getUTCDate() + Number(offset));
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  return { date: date.getUTCFullYear() + "/" + String(date.getUTCMonth() + 1).padStart(2, "0") +
    "/" + String(date.getUTCDate()).padStart(2, "0"),
    weekday: ["日", "月", "火", "水", "木", "金", "土"][date.getUTCDay()] };
}
function renderDateTools(main) {
  main.append(...heading("日付ツール"));
  const today = new Date();
  const todayIso = localIsoDate(today);
  const [y, m, d] = todayIso.split("-");
  const todayCard = el("section", { class: "card date-card" }, [text("h2", "今日の日付をコピー")]);
  const formats = [
    y + "/" + m + "/" + d,
    Number(y) + "年" + Number(m) + "月" + Number(d) + "日",
    yearToJapanese(y) + Number(m) + "月" + Number(d) + "日"
  ];
  // 元号が切り替わる年の「今日」は月日で元号を確定する。
  const todayEra = ERAS.find((e) => {
    const begin = e.name === "令和" ? "2019-05-01" : e.name === "平成" ? "1989-01-08"
      : e.name === "昭和" ? "1926-12-25" : e.name === "大正" ? "1912-07-30" : "1868-01-25";
    const ending = e.name === "平成" ? "2019-04-30" : e.name === "昭和" ? "1989-01-07"
      : e.name === "大正" ? "1926-12-24" : e.name === "明治" ? "1912-07-29" : null;
    return todayIso >= begin && (!ending || todayIso <= ending);
  });
  formats[2] = todayEra ? todayEra.name + (Number(y) === todayEra.start ? "元" :
    Number(y) - todayEra.start + 1) + "年" + Number(m) + "月" + Number(d) + "日" : "対応する元号なし";
  formats.forEach((value) => {
    todayCard.append(el("div", { class: "date-copy-row" }, [
      text("span", value),
      btn("コピー", "button-secondary", () => copyText(value))
    ]));
  });
  main.append(todayCard);

  const converter = el("section", { class: "card date-card" }, [text("h2", "西暦・和暦変換")]);
  const switcher = el("div", { class: "date-direction" });
  [["western", "西暦 → 和暦"], ["japanese", "和暦 → 西暦"]].forEach(([key, title]) => {
    switcher.append(btn(title, conversionDirection === key ? "active" : "", () => {
      conversionDirection = key;
      render();
    }));
  });
  converter.append(switcher);
  const conversionRow = el("div", { class: "date-converter-row" });
  const inputGroup = el("div", { class: "date-input-group" });
  let refresh = () => {};
  if (conversionDirection === "western") {
    inputGroup.append(el("input", {
      type: "number", min: "1", max: "9999", value: westernInputYear,
      "aria-label": "西暦年", placeholder: "西暦年",
      onInput: (ev) => { westernInputYear = ev.target.value; refresh(); }
    }));
  } else {
    const select = el("select", { "aria-label": "元号" });
    ERAS.forEach((e) => select.append(el("option", { value: e.name, text: e.name })));
    select.value = japaneseInputEra;
    select.addEventListener("change", () => {
      japaneseInputEra = select.value; refresh();
    });
    inputGroup.append(select, el("input", {
      type: "number", min: "1", max: "999", value: japaneseInputYear,
      "aria-label": "和暦年", placeholder: "年",
      onInput: (ev) => { japaneseInputYear = ev.target.value; refresh(); }
    }));
  }
  const result = text("div", "", "date-conversion-result");
  result.setAttribute("role", "status");
  refresh = () => {
    result.textContent = conversionDirection === "western"
      ? yearToJapanese(westernInputYear) : japaneseToYear(japaneseInputEra, japaneseInputYear);
  };
  refresh();
  conversionRow.append(inputGroup, text("span", "→", "date-arrow"), result);
  converter.append(conversionRow);
  main.append(converter);

  const calculator = el("section", { class: "card date-card" }, [text("h2", "日付の加算・減算")]);
  const calculateRow = el("div", { class: "date-calculation-controls" });
  const date = el("input", {
    type: "date", value: calculationDate, "aria-label": "基準日",
    onInput: (ev) => { calculationDate = ev.target.value; updateCalculation(); }
  });
  const days = el("input", {
    type: "number", min: "-365000", max: "365000", value: calculationOffset,
    "aria-label": "加算・減算する日数", placeholder: "日数",
    onInput: (ev) => { calculationOffset = ev.target.value; updateCalculation(); }
  });
  calculateRow.append(date, days, text("span", "日後", "date-unit"));
  const calculationResult = text("div", "", "date-calculation-result");
  function updateCalculation() {
    const value = calculateDate(calculationDate, calculationOffset);
    calculationResult.textContent = value ? value.date + "（" + value.weekday + "）" : "日付と日数を確認してください";
  }
  updateCalculation();
  calculator.append(calculateRow, calculationResult,
    text("p", "負の数を入力すると指定日前の日付を表示します。曜日も表示します。", "help"));
  main.append(calculator);
}

function openPersonalEditor(entry) {
  personalEditing = entry && entry.source === "personal" ? entry.id : null;
  personalDraft = entry
    ? { title: entry.title + (entry.source === "shared" ? "（自分用）" : ""), text: entry.text }
    : { title: "", text: "" };
  navigate("personal-editor");
}
function renderPersonalEditor(main) {
  const isEdit = personalEditing !== null;
  main.append(...heading(isEdit ? "定型文を編集" : "定型文を登録",
    "コピーする文字を登録します。文章は複数行でも使えます。"));
  const title = el("input", { value: personalDraft.title, maxlength: MAX_TITLE, placeholder: "例：所属名" });
  const content = el("textarea", { rows: 6, maxlength: MAX_TEXT, placeholder: "コピーしたい文字・文章" });
  content.value = personalDraft.text;
  main.append(field("表示する名前", title), field("コピーする文字", content));
  const controls = el("div", { class: "controls" });
  controls.append(btn("キャンセル", "button-secondary", () => navigate("home")));
  controls.append(btn("保存する", "button-primary", () => {
    const name = title.value.trim();
    const value = normalizeText(content.value);
    if (!name || !value.trim()) return notify("名前とコピーする文字を入力してください。");
    if (isEdit) {
      const target = state.personal.find((item) => item.id === personalEditing);
      if (!target) return notify("編集する定型文が見つかりません。");
      target.title = name;
      target.text = value;
    } else {
      state.personal.push({ id: uniqueId(), title: name, text: value });
    }
    persist();
    navigate("home");
    notify("保存しました");
  }));
  main.append(controls);
  if (isEdit) {
    const deletion = btn("この定型文を削除", "button-danger full", () => {
      const index = state.personal.findIndex((item) => item.id === personalEditing);
      if (index < 0) return;
      const removed = state.personal[index];
      const key = "p:" + removed.id;
      const wasFav = state.favoriteKeys.includes(key);
      state.personal.splice(index, 1);
      state.favoriteKeys = state.favoriteKeys.filter((item) => item !== key);
      persist();
      navigate("home");
      notify("削除しました", () => {
        state.personal.splice(Math.min(index, state.personal.length), 0, removed);
        if (wasFav && !state.favoriteKeys.includes(key)) state.favoriteKeys.push(key);
        persist();
        render();
      });
    });
    deletion.style.marginTop = "18px";
    main.append(deletion);
  }
}

function helpPopup(value) {
  const details = el("details", { class: "help-popover" }, [
    el("summary", { title: "説明を表示", "aria-label": "説明を表示" }, "？"),
    el("p", {}, value)
  ]);
  return details;
}
function settingsLink(icon, title, subtitle, target) {
  return el("button", {
    type: "button", class: "settings-link",
    onClick: () => navigate(target)
  }, [
    text("span", icon, "settings-link-icon"),
    el("span", { class: "settings-link-text" }, [
      text("strong", title), text("small", subtitle)
    ]),
    text("span", "›", "settings-link-arrow")
  ]);
}
function renderSettings(main) {
  main.append(...heading("設定"));
  main.append(el("section", { class: "settings-links" }, [
    settingsLink("▦", "表示する機能", "機能の追加・非表示", "feature-settings"),
    settingsLink("▣", "組織共通データ", "取り込み・有効／無効・削除", "shared-manager"),
    settingsLink("▤", "バックアップ・復元", "個人データと設定をまとめて保存", "backup-manager")
  ]));
  if (state.developerEnabled) {
    const devBox = el("section", { class: "card" }, [
      text("h2", "開発者用メニュー"),
      btn("共通JSONを作成・編集", "button-secondary full", () => navigate("developer")),
      btn("開発者モードを終了", "button-plain full", () => {
        state.developerEnabled = false;
        devDraft = null;
        persist(); render(); notify("開発者モードを終了しました");
      })
    ]);
    main.append(devBox);
  }
  const version = el("button", {
    type: "button", class: "version", "aria-label": "バージョン 0.3.0",
    onClick: () => {
      if (state.developerEnabled) return;
      const now = Date.now();
      versionTapCount = now - lastVersionTap > 3000 ? 1 : versionTapCount + 1;
      lastVersionTap = now;
      if (versionTapCount >= 5) {
        versionTapCount = 0;
        state.developerEnabled = true;
        persist(); render(); notify("開発者モードを有効にしました");
      } else if (versionTapCount >= 3) {
        const hint = document.getElementById("developer-hint");
        if (hint) hint.textContent = "あと" + (5 - versionTapCount) + "回で開発者モード";
      }
    }
  }, "うらちゃんツール v0.3.0");
  main.append(version, el("div", { id: "developer-hint", class: "dev-hint" }));
  main.append(helpPopup("データはこのPCのChromeプロファイルに保存されます。共用PCでは他の利用者から見える可能性があります。"));
}
function renderFeatureSettings(main) {
  main.append(...heading("表示する機能"));
  main.append(text("p", "使う機能だけを選択できます。いつでも変更できます。", "explain"));
  const section = el("section", { class: "card feature-settings-card" });
  FEATURES.forEach((feature) => {
    const checkbox = el("input", {
      type: "checkbox", checked: state.visibleModules.includes(feature.id),
      "aria-label": feature.name + "を表示",
      onChange: (event) => {
        const next = event.target.checked
          ? [...state.visibleModules, feature.id]
          : state.visibleModules.filter((id) => id !== feature.id);
        if (!next.length) {
          event.target.checked = true;
          notify("少なくとも1つの機能を表示してください。");
          return;
        }
        state.visibleModules = next;
        if (!next.includes(activeModule)) activeModule = next[0];
        persist();
      }
    });
    section.append(el("label", { class: "feature-setting-row" }, [
      el("span", {}, [
        text("strong", feature.name),
        text("small", feature.description)
      ]), checkbox
    ]));
  });
  main.append(section);
}
function renderSharedManager(main) {
  main.append(...heading("組織共通データ"));
  const fileBox = el("section", { class: "card" }, [
    el("div", { class: "card-heading" }, [
      text("h2", "JSONファイルを取り込む"),
      helpPopup("配布されたJSONを読み込むと、新しいセットは追加され、同じIDのセットは置き換わります。無効にした状態は維持されます。")
    ])
  ]);
  fileBox.append(attachJsonInput(async (data) => {
    pendingSharedImport = validateShared(data);
    render();
  }));
  main.append(fileBox);
  if (pendingSharedImport) {
    const set = pendingSharedImport;
    const existing = state.sharedSets.find((item) => item.id === set.id);
    const confirmBox = el("section", { class: "card import-preview" }, [
      text("h2", "取り込み内容の確認"),
      text("strong", set.name),
      text("p", set.items.length + "件の定型文 ／ " +
        (existing ? "既存の" + existing.items.length + "件を置き換え" : "新規追加")),
      text("p", "個人用データは変更されません。")
    ]);
    confirmBox.append(el("div", { class: "controls" }, [
      btn("キャンセル", "button-secondary", () => { pendingSharedImport = null; render(); }),
      btn("取り込む", "button-primary", () => {
        const wasExisting = Boolean(existing);
        upsertShared(set);
        pendingSharedImport = null;
        render();
        notify((wasExisting ? "更新" : "取り込み") + "しました：" + set.name);
      })
    ]));
    main.append(confirmBox);
  }
  main.append(el("div", { class: "card-heading section-separator" }, [
    text("h2", "取り込み済みのセット"),
    helpPopup("無効にするとすべての定型文タブから非表示になります。データとお気に入りは残るため、再度有効にすると元どおり表示されます。")
  ]));
  if (!state.sharedSets.length) {
    main.append(el("div", { class: "empty" }, [
      text("strong", "まだ共通データがありません"),
      text("p", "配布されたJSONファイルを取り込んでください。")
    ]));
    return;
  }
  state.sharedSets.forEach((set) => {
    const checkbox = el("input", {
      type: "checkbox", checked: isSharedEnabled(set.id),
      "aria-label": set.name + "を有効にする",
      onChange: (event) => {
        setSharedEnabled(set.id, event.target.checked);
      }
    });
    const card = el("section", { class: "card shared-set-card" }, [
      el("div", { class: "shared-set-top" }, [
        el("div", { class: "shared-set-title" }, [
          text("strong", set.name),
          text("small", set.items.length + "件の定型文")
        ]),
        el("label", { class: "shared-switch" }, [checkbox, text("span", "有効")])
      ]),
      btn("詳細を見る ›", "button-secondary full", () => {
        selectedSharedSetId = set.id;
        navigate("shared-details");
      })
    ]);
    main.append(card);
  });
}
function renderSharedDetails(main) {
  const set = state.sharedSets.find((item) => item.id === selectedSharedSetId);
  if (!set) return navigate("shared-manager");
  main.append(...heading("セットの詳細"));
  const card = el("section", { class: "card" }, [
    text("h2", set.name),
    text("p", "定型文：" + set.items.length + "件"),
    text("p", set.importedAt ? "取り込み日：" + new Date(set.importedAt).toLocaleDateString("ja-JP") : "")
  ]);
  const enabled = el("input", {
    type: "checkbox", checked: isSharedEnabled(set.id),
    "aria-label": "このセットを有効にする",
    onChange: (event) => setSharedEnabled(set.id, event.target.checked)
  });
  card.append(el("label", { class: "feature-setting-row" }, [
    text("strong", "このセットを使用する"), enabled
  ]));
  main.append(card);
  const danger = el("section", { class: "card" }, [
    text("h2", "このPCから削除"),
    text("p", "削除するとこのセットの共通定型文と、そのお気に入り設定が消えます。個人用にコピーした定型文は残ります。")
  ]);
  danger.append(btn("このセットを削除", "button-danger full", () => {
    if (!confirm("「" + set.name + "」をこのPCから削除します。元には戻せません。続けますか？")) return;
    removeSharedSet(set.id);
    selectedSharedSetId = null;
    navigate("shared-manager");
    notify("共通セットを削除しました");
  }));
  main.append(danger);
}
function renderBackupManager(main) {
  main.append(...heading("バックアップ・復元"));
  const backup = el("section", { class: "card" }, [
    el("div", { class: "card-heading" }, [
      text("h2", "バックアップ"),
      helpPopup("個人用定型文、お気に入り、あとで見るのURL・タイトル・タグ・保存ボタン、機能の表示設定、組織共通セットの有効・無効を一括保存します。組織共通の本文は含みません。")
    ])
  ]);
  backup.append(btn("バックアップを保存", "button-primary full", () => {
    exportJson("urachan-backup.json", createBackup());
    notify("バックアップを保存しました");
  }));
  const restore = el("section", { class: "card" }, [
    el("div", { class: "card-heading" }, [
      text("h2", "バックアップから復元"),
      helpPopup("復元すると、現在の個人用定型文・お気に入り・表示設定を置き換えます。v0.3.0以降のバックアップにはブックマークも含み、同時に置き換えます。旧バックアップにブックマーク情報がない場合は現在のものを維持します。組織共通本文は変更しません。")
    ])
  ]);
  restore.append(attachJsonInput(async (data) => {
    const imported = validateBackup(data);
    if (!confirm("現在の個人用データと設定をバックアップの内容で置き換えます。続けますか？")) return;
    state.personal = imported.personal;
    state.favoriteKeys = imported.favoriteKeys;
    state.visibleModules = imported.visibleModules;
    state.sharedPreferences = imported.sharedPreferences;
    if (imported.bookmarks) {
      state.bookmarks = imported.bookmarks.items;
      state.bookmarkPresets = imported.bookmarks.presets;
      state.bookmarkTags = imported.bookmarks.tags;
    }
    if (!state.visibleModules.includes(activeModule)) activeModule = state.visibleModules[0];
    await persist();
    render();
    notify("バックアップから復元しました");
  }));
  main.append(backup, restore);
}
function newSharedDraft() {
  devApplyLocally = false;
  devDraft = { id: "set-" + uniqueId(), name: "", items: [] };
  devItemIndex = null;
  devItemDraft = null;
  render();
}
function openSharedDraft(id) {
  devApplyLocally = false;
  const set = state.sharedSets.find((entry) => entry.id === id);
  if (!set) return;
  devDraft = structuredClone(set);
  devItemIndex = null;
  devItemDraft = null;
  render();
}
function ensureSharedDraft() {
  if (!devDraft) throw Error("共通データを作成してください。");
  const normalized = validateShared({
    format: "urachan-shared", version: 1, set: devDraft
  });
  if (normalized.items.length === 0) throw Error("定型文を1件以上登録してください。");
  return normalized;
}
function showDevItemEditor(index) {
  devItemIndex = index;
  devItemDraft = index >= 0
    ? structuredClone(devDraft.items[index])
    : { id: uniqueId(), title: "", text: "" };
  render();
}
function renderDeveloper(main) {
  if (!state.developerEnabled) return navigate("settings");
  main.append(...heading("共通JSONの作成", "ここで共通の文章を作り、JSONファイルとして配布できます。"));
  main.append(text("p", "公開GitHubには実際の庁内情報や個人情報を登録しないでください。", "info warning"));
  const options = el("section", { class: "card" }, [
    text("h2", "共通セットを選ぶ"),
    text("p", "新しく作るか、このPCにあるセットを読み込んで編集します。")
  ]);
  options.append(btn("＋ 新しいセットを作成", "button-primary full", newSharedDraft));
  if (state.sharedSets.length) {
    const selector = el("select", { "aria-label": "編集するセットを選ぶ" }, [
      el("option", { value: "", text: "既存のセットを選択" })
    ]);
    state.sharedSets.forEach((set) => selector.append(el("option", { value: set.id, text: set.name })));
    selector.addEventListener("change", () => {
      if (selector.value) openSharedDraft(selector.value);
    });
    options.append(field("このPCの共通セット", selector));
  }
  options.append(field("配布用JSONを読み込んで編集", attachJsonInput(async (data) => {
    devDraft = validateShared(data);
    devApplyLocally = false;
    devItemIndex = null;
    devItemDraft = null;
    render();
    notify("編集用に読み込みました。このPCへの反映はまだです。");
  })));
  main.append(options);
  if (!devDraft) return;
  const editor = el("section", { class: "card" }, [
    text("h2", "編集中の共通セット"),
    text("p", "作成したJSONを配布できます。このPCへの反映は任意です。")
  ]);
  const nameInput = el("input", {
    value: devDraft.name, maxlength: MAX_TITLE, placeholder: "例：総務課の定型文",
    onInput: (event) => { devDraft.name = event.target.value; }
  });
  editor.append(field("セット名", nameInput));
  editor.append(text("h2", "定型文（" + devDraft.items.length + "件）"));
  devDraft.items.forEach((item, index) => {
    const summary = el("div", { class: "draft-row" }, [
      text("strong", item.title), text("p", item.text)
    ]);
    const controls = el("div", { class: "controls" }, [
      btn("編集", "button-secondary", () => showDevItemEditor(index)),
      btn("削除", "button-danger", () => {
        devDraft.items.splice(index, 1);
        devItemIndex = null;
        devItemDraft = null;
        render();
      })
    ]);
    summary.append(controls);
    editor.append(summary);
  });
  if (devItemIndex !== null) {
    const itemBox = el("div", { class: "card" }, [
      text("h2", devItemIndex < 0 ? "定型文を追加" : "定型文を編集")
    ]);
    const titleInput = el("input", {
      value: devItemDraft.title, maxlength: MAX_TITLE, placeholder: "定型文の名前"
    });
    const textInput = el("textarea", { rows: 5, maxlength: MAX_TEXT, placeholder: "コピーする内容" });
    textInput.value = devItemDraft.text;
    itemBox.append(field("表示する名前", titleInput), field("コピーする文字", textInput));
    itemBox.append(el("div", { class: "controls" }, [
      btn("キャンセル", "button-secondary", () => { devItemIndex = null; render(); }),
      btn("この文章を保存", "button-primary", () => {
        const title = titleInput.value.trim();
        const value = normalizeText(textInput.value);
        if (!title || !value.trim()) return notify("名前とコピーする文字を入力してください。");
        const item = { id: devItemDraft.id, title, text: value };
        if (devItemIndex < 0) devDraft.items.push(item);
        else devDraft.items[devItemIndex] = item;
        devItemIndex = null;
        devItemDraft = null;
        render();
      })
    ]));
    editor.append(itemBox);
  } else {
    editor.append(btn("＋ 定型文を追加", "button-secondary full", () => showDevItemEditor(-1)));
  }
  const controls = el("div", { class: "controls" });
  editor.append(el("label", { class: "checkbox-row" }, [
    el("input", {
      type: "checkbox", checked: devApplyLocally,
      onChange: (event) => { devApplyLocally = event.target.checked; }
    }),
    "JSON書き出し時にこのPCにも反映する"
  ]));
  controls.append(btn("このPCに反映", "button-secondary", () => {
    try {
      const set = ensureSharedDraft();
      upsertShared(set);
      notify("このPCの共通定型文に反映しました");
    } catch (error) { notify(error.message); }
  }));
  controls.append(btn("JSONを書き出す", "button-primary", () => {
    try {
      const set = ensureSharedDraft();
      if (devApplyLocally) upsertShared(set);
      exportJson("urachan-common-" + safeName(set.id) + ".json", {
        format: "urachan-shared", version: 1, set
      });
      notify(devApplyLocally ? "共通JSONを書き出し、このPCにも反映しました。" : "共通JSONを書き出しました。このPCには反映していません。");
    } catch (error) { notify(error.message); }
  }));
  editor.append(controls);
  // 共通セットの削除は一般向けの組織共通データ管理画面に集約します。
  main.append(editor);
}
function render() {
  app.replaceChildren();
  app.append(renderHeader());
  const main = el("main");
  if (view === "home") renderHome(main);
  else if (view === "settings") renderSettings(main);
  else if (view === "feature-settings") renderFeatureSettings(main);
  else if (view === "shared-manager") renderSharedManager(main);
  else if (view === "shared-details") renderSharedDetails(main);
  else if (view === "backup-manager") renderBackupManager(main);
  else if (view === "personal-editor") renderPersonalEditor(main);
  else if (view === "bookmark-presets") renderBookmarkPresets(main);
  else if (view === "bookmark-preset-editor") renderBookmarkPresetEditor(main);
  else if (view === "developer") renderDeveloper(main);
  if (view !== "home") {
    main.append(el("div", { class: "footer-top" }, [
      btn("⌂ TOPに戻る", "button-secondary full", () => navigate("home"))
    ]));
  }
  app.append(main);
}
async function start() {
  try {
    const value = await chrome.storage.local.get(STORAGE_KEY);
    const stored = value[STORAGE_KEY];
    if (stored && stored.version === 2
      && Array.isArray(stored.personal) && Array.isArray(stored.sharedSets)
      && Array.isArray(stored.favoriteKeys) && Array.isArray(stored.sharedPreferences)
      && Array.isArray(stored.visibleModules)) {
      state = {
        ...structuredClone(DEFAULT_STATE),
        developerEnabled: stored.developerEnabled === true,
        personal: stored.personal,
        sharedSets: stored.sharedSets,
        favoriteKeys: stored.favoriteKeys,
        sharedPreferences: stored.sharedPreferences,
        visibleModules: stored.visibleModules.filter((id) => FEATURES.some((f) => f.id === id))
      };
      try {
        const savedBookmarks = stored.bookmarks === undefined
          ? { items: [], presets: structuredClone(DEFAULT_BOOKMARK_PRESETS),
              tags: [...DEFAULT_BOOKMARK_TAGS] }
          : validateBookmarkData({
              items: stored.bookmarks,
              presets: stored.bookmarkPresets,
              tags: stored.bookmarkTags
            });
        state.bookmarks = savedBookmarks.items;
        state.bookmarkPresets = savedBookmarks.presets;
        state.bookmarkTags = savedBookmarks.tags;
      } catch (error) {
        console.error("ブックマークを読み込めませんでした", error);
        notify("ブックマークの読み込みに失敗しました。バックアップをご確認ください。");
      }
      if (!state.visibleModules.length) state.visibleModules = ["templates"];
    }
  } catch (error) {
    console.error("保存データを読み込めませんでした", error);
    notify("保存データを読み込めませんでした。");
  }
  render();
}

start();
