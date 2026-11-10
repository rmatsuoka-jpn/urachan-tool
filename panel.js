"use strict";

const STORAGE_KEY = "urachanAppState";
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ITEMS = 500;
const MAX_TITLE = 80;
const MAX_TEXT = 10000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const TAB_NAMES = [
  ["all", "すべて"],
  ["favorites", "★ お気に入り"],
  ["personal", "個人"],
  ["shared", "組織共通"]
];
const DEFAULT_STATE = {
  version: 1,
  displayMode: "simple",
  developerEnabled: false,
  personal: [],
  sharedSets: [],
  favoriteKeys: []
};

let state = structuredClone(DEFAULT_STATE);
let view = "home";
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
function entries() {
  const personal = state.personal.map((item) => ({ ...item, source: "personal" }));
  const shared = state.sharedSets.flatMap((set) =>
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
  if (index >= 0) state.sharedSets[index] = structuredClone(set);
  else state.sharedSets.push(structuredClone(set));
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
  const title = row(text("span", "▣", "brand-mark"), text("span", "うらちゃんツール", "brand"));
  const back = view === "home"
    ? btn("⚙ 設定", "settings-button", () => navigate("settings"))
    : btn("← 戻る", "settings-button", () => navigate(view === "settings" ? "home" : "settings"));
  back.className = "settings-button";
  const close = el("button", {
    type: "button",
    class: "settings-button close-button",
    title: "サイドパネルをとじる",
    "aria-label": "サイドパネルをとじる",
    onClick: () => { void closeSidePanel(); }
  }, "× とじる");
  const controls = el("div", { class: "header-actions" }, [back, close]);
  header.append(el("div", { class: "topbar" }, [title, controls]));
  if (state.displayMode === "advanced" && (view === "home" || view === "settings")) {
    const nav = el("nav", { class: "mode-nav", "aria-label": "拡張モードのメニュー" });
    const copy = btn("定型文", "", () => navigate("home"));
    const setting = btn("データ管理", "", () => navigate("settings"));
    const future = btn("便利ツール（準備中）", "coming", () => {});
    future.disabled = true;
    copy.className = view === "home" ? "active" : "";
    setting.className = view === "settings" ? "active" : "";
    nav.append(copy, setting, future);
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
function renderSettings(main) {
  main.append(...heading("設定", "普段は設定を変えなくても、そのまま利用できます。"));
  const modeBox = el("section", { class: "card" }, [text("h2", "表示モード")]);
  const labelSimple = el("label", { class: "checkbox-row" }, [
    el("input", {
      type: "radio", name: "displayMode", value: "simple", checked: state.displayMode === "simple",
      onChange: () => { state.displayMode = "simple"; persist(); render(); }
    }), "シンプル（定型文コピー中心）"
  ]);
  const labelAdvanced = el("label", { class: "checkbox-row" }, [
    el("input", {
      type: "radio", name: "displayMode", value: "advanced", checked: state.displayMode === "advanced",
      onChange: () => { state.displayMode = "advanced"; persist(); render(); }
    }), "拡張（機能メニューを表示）"
  ]);
  modeBox.append(labelSimple, labelAdvanced);
  main.append(modeBox);
  const common = el("section", { class: "card" }, [
    text("h2", "組織共通定型文を取り込む"),
    text("p", "配布されたJSONファイルを選ぶだけで追加・更新できます。個人用の定型文は変更されません。")
  ]);
  common.append(attachJsonInput(async (data) => {
    const set = validateShared(data);
    const exists = state.sharedSets.some((x) => x.id === set.id);
    upsertShared(set);
    notify((exists ? "更新" : "取り込み") + "しました：" + set.name + "（" + set.items.length + "件）");
  }));
  if (state.sharedSets.length) {
    common.append(text("p", "取り込み済み：" + state.sharedSets.map((set) => set.name).join("、"), "help"));
  }
  main.append(common);
  const personalBox = el("section", { class: "card" }, [
    text("h2", "個人データのバックアップ・復元"),
    text("p", "個人用の定型文とお気に入りを、JSONファイルで保存・復元できます。")
  ]);
  personalBox.append(btn("バックアップを保存", "button-secondary full", () => {
    exportJson("urachan-personal.json", {
      format: "urachan-personal", version: 1,
      personal: state.personal, favoriteKeys: state.favoriteKeys
    });
    notify("個人データをファイルに書き出しました");
  }));
  personalBox.append(field("バックアップを復元", attachJsonInput(async (data) => {
    const imported = validatePersonal(data);
    if (!confirm("個人用の定型文とお気に入りをバックアップの内容で置き換えます。続けますか？")) return;
    state.personal = imported.personal;
    state.favoriteKeys = imported.favoriteKeys;
    await persist();
    notify("個人データを復元しました");
  }), "復元すると現在の個人用データは置き換わります。共通定型文は維持します。"));
  main.append(personalBox);
  if (state.developerEnabled) {
    const devBox = el("section", { class: "card" }, [
      text("h2", "開発者用メニュー"),
      text("p", "組織共通JSONの作成・編集・書き出しを行います。")
    ]);
    devBox.append(btn("共通JSONを作成・編集", "button-secondary full", () => navigate("developer")));
    devBox.append(btn("開発者モードを終了", "button-plain full", () => {
      state.developerEnabled = false;
      devDraft = null;
      persist();
      render();
      notify("開発者モードを終了しました");
    }));
    main.append(devBox);
  }
  const version = el("button", {
    type: "button", class: "version", "aria-label": "バージョン 0.1.1",
    onClick: () => {
      if (state.developerEnabled) return;
      const now = Date.now();
      versionTapCount = now - lastVersionTap > 3000 ? 1 : versionTapCount + 1;
      lastVersionTap = now;
      if (versionTapCount >= 5) {
        versionTapCount = 0;
        state.developerEnabled = true;
        persist();
        render();
        notify("開発者モードを有効にしました");
      } else if (versionTapCount >= 3) {
        const hint = document.getElementById("developer-hint");
        if (hint) hint.textContent = "あと" + (5 - versionTapCount) + "回で開発者モード";
      }
    }
  }, "うらちゃんツール v0.1.1");
  main.append(version, el("div", { id: "developer-hint", class: "dev-hint" }));
  main.append(text("p", "このPC内に保存されます。共用PCでは同じChromeプロファイルの利用者に内容が見える場合があります。", "info warning"));
}
function newSharedDraft() {
  devDraft = { id: "set-" + uniqueId(), name: "", items: [] };
  devItemIndex = null;
  devItemDraft = null;
  render();
}
function openSharedDraft(id) {
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
    devItemIndex = null;
    devItemDraft = null;
    render();
    notify("編集用に読み込みました。このPCへの反映はまだです。");
  })));
  main.append(options);
  if (!devDraft) return;
  const editor = el("section", { class: "card" }, [
    text("h2", "編集中の共通セット"),
    text("p", "変更は「このPCに反映」または「JSONを書き出す」で保存します。")
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
      upsertShared(set);
      exportJson("urachan-common-" + safeName(set.id) + ".json", {
        format: "urachan-shared", version: 1, set
      });
      notify("共通JSONを書き出しました。このPCにも反映済みです。");
    } catch (error) { notify(error.message); }
  }));
  editor.append(controls);
  if (state.sharedSets.some((set) => set.id === devDraft.id)) {
    editor.append(btn("このPCから共通セットを削除", "button-danger full", () => {
      if (!confirm("このPCから共通セットを削除します。個人用の定型文は変更されません。続けますか？")) return;
      const id = devDraft.id;
      state.sharedSets = state.sharedSets.filter((set) => set.id !== id);
      state.favoriteKeys = state.favoriteKeys.filter((key) => !key.startsWith("s:" + id + ":"));
      devDraft = null;
      persist();
      render();
      notify("共通セットを削除しました");
    }));
  }
  main.append(editor);
}
function render() {
  app.replaceChildren();
  app.append(renderHeader());
  const main = el("main");
  if (view === "home") renderHome(main);
  else if (view === "settings") renderSettings(main);
  else if (view === "personal-editor") renderPersonalEditor(main);
  else if (view === "developer") renderDeveloper(main);
  app.append(main);
}
async function start() {
  try {
    const value = await chrome.storage.local.get(STORAGE_KEY);
    const stored = value[STORAGE_KEY];
    if (stored && stored.version === 1 && Array.isArray(stored.personal)
      && Array.isArray(stored.sharedSets) && Array.isArray(stored.favoriteKeys)) {
      state = {
        version: 1,
        displayMode: stored.displayMode === "advanced" ? "advanced" : "simple",
        developerEnabled: stored.developerEnabled === true,
        personal: stored.personal,
        sharedSets: stored.sharedSets,
        favoriteKeys: stored.favoriteKeys
      };
    }
  } catch (error) {
    console.error("保存データを読み込めませんでした", error);
    notify("保存データを読み込めませんでした。");
  }
  render();
}
start();
