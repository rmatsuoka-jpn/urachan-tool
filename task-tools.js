"use strict";
(() => {
  const MAX_TICKETS = 2000;
  const MAX_HISTORY = 300;
  const MAX_NOTE = 10000;
  const MAX_ANSWER = 12000;
  const MAX_HISTORY_TEXT = 8000;
  const MAX_TAGS_PER_TICKET = 12;
  const MAX_TAG_LENGTH = 40;
  const MAX_REFS = 3000;
  const view = {
    screen: "list", currentId: null, addHistory: false,
    query: "", filter: "open", sort: "new",
    quickTitle: "", quickNote: "", showQuickNote: false,
    exportScope: "knowledge", exportFormat: "md",
    exportFrom: "", exportTo: "",
    includeHistory: true, includeAnswer: true, includeReferences: true
  };
  let mount = null;
  let api = null;

  function isDate(value) {
    if (value === "") return true;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + "T00:00:00");
    return Number.isFinite(d.getTime()) && d.getFullYear() === Number(value.slice(0, 4))
      && d.getMonth() + 1 === Number(value.slice(5, 7))
      && d.getDate() === Number(value.slice(8, 10));
  }
  function validIso(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }
  function validText(value, max) {
    return typeof value === "string" && value.length <= max;
  }
  function validateTickets(items) {
    if (!Array.isArray(items) || items.length > MAX_TICKETS) throw Error("メモ・タスクの件数が多すぎるか形式が正しくありません。");
    const ids = new Set();
    return items.map((ticket) => {
      if (!ticket || typeof ticket !== "object"
        || typeof ticket.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(ticket.id)
        || ids.has(ticket.id)
        || !validText(ticket.title, 150) || !ticket.title.trim()
        || !validText(ticket.note, MAX_NOTE)
        || !validText(ticket.finalAnswer, MAX_ANSWER)
        || !validText(ticket.references, MAX_REFS)
        || !validIso(ticket.createdAt) || !validIso(ticket.updatedAt)
        || !(ticket.completedAt === null || validIso(ticket.completedAt))
        || !isDate(ticket.dueDate)
        || typeof ticket.knowledge !== "boolean"
        || !Array.isArray(ticket.tags) || ticket.tags.length > MAX_TAGS_PER_TICKET
        || ticket.tags.some((tag) => !validText(tag, MAX_TAG_LENGTH) || !tag.trim())
        || new Set(ticket.tags).size !== ticket.tags.length
        || !Array.isArray(ticket.history) || ticket.history.length > MAX_HISTORY) {
        throw Error("メモ・タスクの登録内容が正しくありません。");
      }
      const historyIds = new Set();
      const history = ticket.history.map((item) => {
        if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(item.id)
          || historyIds.has(item.id) || !validIso(item.createdAt)
          || !validText(item.text, MAX_HISTORY_TEXT) || !item.text.trim()) {
          throw Error("対応履歴の内容が正しくありません。");
        }
        historyIds.add(item.id);
        return { id: item.id, createdAt: item.createdAt, text: item.text };
      });
      ids.add(ticket.id);
      return {
        id: ticket.id, title: ticket.title, note: ticket.note,
        createdAt: ticket.createdAt, updatedAt: ticket.updatedAt,
        completedAt: ticket.completedAt, dueDate: ticket.dueDate,
        history, finalAnswer: ticket.finalAnswer, references: ticket.references,
        knowledge: ticket.knowledge, tags: [...ticket.tags]
      };
    });
  }
  function createTicket(title, note = "", now = new Date().toISOString(), id = crypto.randomUUID()) {
    if (typeof title !== "string" || !title.trim() || title.trim().length > 150
      || !validText(note, MAX_NOTE)) throw Error("件名は150文字以内で入力してください。");
    return {
      id, title: title.trim(), note: note.trim(),
      createdAt: now, updatedAt: now, completedAt: null, dueDate: "",
      history: [], finalAnswer: "", references: "", knowledge: false, tags: []
    };
  }
  function dateTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  }
  function localDate(when) {
    const d = when instanceof Date ? when : new Date(when);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  }
  function today() { return localDate(new Date()); }
  function E(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "class") node.className = value;
      else if (name === "text") node.textContent = value;
      else if (name === "value") node.value = value;
      else if (name === "checked") node.checked = Boolean(value);
      else if (name === "disabled") node.disabled = Boolean(value);
      else if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2).toLowerCase(), value);
      else if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    }
    for (const child of (Array.isArray(children) ? children : [children])) {
      if (child !== undefined && child !== null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  function B(label, style, handler, attributes = {}) {
    return E("button", { type: "button", class: "ticket-button " + style, onClick: handler, ...attributes }, label);
  }
  function T(tag, value, css = "") { return E(tag, { text: value, class: css }); }
  function line(...items) { return E("div", { class: "ticket-line" }, items); }
  function field(label, input) {
    return E("label", { class: "ticket-field" }, [T("span", label), input]);
  }
  function input(type, placeholder = "", value = "") {
    return E("input", { type, placeholder, value, class: "ticket-input" });
  }
  function area(placeholder = "", value = "", rows = 3) {
    return E("textarea", { class: "ticket-input", placeholder, rows, value });
  }
  function redraw() { if (mount) renderInto(); }
  function saveAndRedraw(message) {
    void api.persist();
    redraw();
    if (message) api.notify(message);
  }
  function currentTickets() { return api.state.tasks; }
  function openDetail(id, addHistory = false) {
    view.currentId = id;
    view.addHistory = addHistory;
    view.screen = "detail";
    redraw();
    if (addHistory) mount.querySelector("[data-history-editor]")?.focus();
  }
  function toggleDone(ticket) {
    const wasDone = Boolean(ticket.completedAt);
    ticket.completedAt = wasDone ? null : new Date().toISOString();
    ticket.updatedAt = new Date().toISOString();
    saveAndRedraw(wasDone ? "未完了に戻しました" : "完了にしました");
  }
  function toggleKnowledge(ticket) {
    ticket.knowledge = !ticket.knowledge;
    ticket.updatedAt = new Date().toISOString();
    saveAndRedraw(ticket.knowledge ? "ナレッジ候補にしました" : "ナレッジ候補を解除しました");
  }
  function dueBadge(ticket) {
    if (!ticket.dueDate) return null;
    const overdue = !ticket.completedAt && ticket.dueDate < today();
    const current = !ticket.completedAt && ticket.dueDate === today();
    return T("span", (overdue ? "期限超過 " : current ? "今日まで " : "期限 ") + ticket.dueDate,
      "ticket-due " + (overdue ? "ticket-overdue" : current ? "ticket-today" : ""));
  }
  function filtered() {
    const term = view.query.trim().toLocaleLowerCase("ja-JP");
    return currentTickets().filter((ticket) => {
      if (view.filter === "open" && ticket.completedAt) return false;
      if (view.filter === "done" && !ticket.completedAt) return false;
      if (view.filter === "knowledge" && !ticket.knowledge) return false;
      if (!term) return true;
      return [ticket.title, ticket.note, ticket.finalAnswer, ticket.references,
        ...ticket.tags, ...ticket.history.map((h) => h.text)].join("\n")
        .toLocaleLowerCase("ja-JP").includes(term);
    }).sort((a, b) => {
      if (view.sort === "due") {
        const x = a.dueDate || "9999-12-31", y = b.dueDate || "9999-12-31";
        if (x !== y) return x.localeCompare(y);
      }
      if (view.sort === "old") return a.createdAt.localeCompare(b.createdAt);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }
  function renderList() {
    mount.append(T("h1", "メモ・タスク", "page-heading"));
    mount.append(T("p", "件名だけで登録できます。必要なときに履歴や回答を追記します。", "explain"));
    const quick = E("section", { class: "ticket-panel ticket-quick" });
    const quickInput = input("text", "やること・問い合わせの件名", view.quickTitle);
    quickInput.maxLength = 150;
    quickInput.addEventListener("input", () => { view.quickTitle = quickInput.value; });
    const create = () => {
      try {
        if (currentTickets().length >= MAX_TICKETS) throw Error("登録上限に達しました。不要な記録を整理してください。");
        const newTicket = createTicket(view.quickTitle, view.quickNote);
        currentTickets().unshift(newTicket);
        view.quickTitle = ""; view.quickNote = ""; view.showQuickNote = false;
        saveAndRedraw("登録しました");
      } catch (error) { api.notify(error.message); }
    };
    quickInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) create();
    });
    quick.append(quickInput);
    if (view.showQuickNote) {
      const quickNote = area("メモ（任意）", view.quickNote, 2);
      quickNote.maxLength = MAX_NOTE;
      quickNote.addEventListener("input", () => { view.quickNote = quickNote.value; });
      quick.append(quickNote);
    }
    quick.append(line(
      B(view.showQuickNote ? "－ メモを閉じる" : "＋ メモも入力", "ticket-link", () => {
        view.showQuickNote = !view.showQuickNote; redraw();
      }),
      B("＋ 登録", "ticket-main", create)
    ));
    mount.append(quick);
    const count = currentTickets().filter((ticket) => !ticket.completedAt).length;
    mount.append(T("p", "未完了 " + count + "件 ／ 全 " + currentTickets().length + "件", "ticket-count"));
    const controls = E("div", { class: "ticket-filters" });
    const search = input("search", "件名・メモ・履歴を検索", view.query);
    const filter = E("select", { class: "ticket-input", "aria-label": "表示する記録" }, [
      ["open", "未完了"], ["done", "完了"], ["all", "すべて"], ["knowledge", "★ ナレッジ候補"]
    ].map(([value, label]) => E("option", { value, text: label })));
    filter.value = view.filter;
    const sort = E("select", { class: "ticket-input", "aria-label": "並び替え" }, [
      ["new", "新しい順"], ["old", "古い順"], ["due", "期限が近い順"]
    ].map(([value, label]) => E("option", { value, text: label })));
    sort.value = view.sort;
    const list = E("div", { class: "ticket-list" });
    search.addEventListener("input", () => { view.query = search.value; renderRows(list); });
    filter.addEventListener("change", () => { view.filter = filter.value; renderRows(list); });
    sort.addEventListener("change", () => { view.sort = sort.value; renderRows(list); });
    controls.append(search, line(filter, sort));
    mount.append(controls, list);
    renderRows(list);
    mount.append(B("記録を出力（Markdown / CSV / JSON）", "ticket-secondary ticket-full", () => {
      view.screen = "export"; redraw();
    }));
  }
  function renderRows(list) {
    list.replaceChildren();
    const items = filtered();
    if (!items.length) {
      list.append(E("div", { class: "ticket-empty" }, [
        T("strong", currentTickets().length ? "該当する記録はありません" : "まだメモがありません"),
        T("p", currentTickets().length ? "検索条件や表示対象を変えてください。" : "上の入力欄から最初のメモを登録しましょう。")
      ]));
      return;
    }
    for (const ticket of items) {
      const wrap = E("section", { class: "ticket-item" });
      const check = E("input", { type: "checkbox", checked: Boolean(ticket.completedAt),
        "aria-label": ticket.title + (ticket.completedAt ? "を未完了に戻す" : "を完了する") });
      check.addEventListener("change", () => toggleDone(ticket));
      const title = B(ticket.title, "ticket-title " + (ticket.completedAt ? "ticket-completed" : ""),
        () => openDetail(ticket.id));
      const star = B(ticket.knowledge ? "★" : "☆", "ticket-star " + (ticket.knowledge ? "ticket-star-on" : ""),
        () => toggleKnowledge(ticket), { title: ticket.knowledge ? "ナレッジ候補を解除" : "ナレッジ候補にする",
          "aria-label": ticket.title + "のナレッジ候補を切り替え" });
      wrap.append(line(check, title, star));
      const meta = E("div", { class: "ticket-meta" }, [
        T("span", "登録 " + dateTime(ticket.createdAt)),
        T("span", "履歴 " + ticket.history.length + "件"),
        T("span", ticket.finalAnswer.trim() ? "回答記録あり" : "回答記録なし",
          "ticket-answer " + (ticket.finalAnswer.trim() ? "ticket-answered" : "ticket-unanswered"))
      ]);
      if (dueBadge(ticket)) meta.append(dueBadge(ticket));
      wrap.append(meta, line(
        B("＋ 追記", "ticket-secondary", () => openDetail(ticket.id, true)),
        B("詳細", "ticket-link", () => openDetail(ticket.id))
      ));
      list.append(wrap);
    }
  }
  function renderDetail() {
    const ticket = currentTickets().find((item) => item.id === view.currentId);
    if (!ticket) { view.screen = "list"; renderList(); return; }
    mount.append(B("← 一覧へ", "ticket-link", () => { view.screen = "list"; redraw(); }));
    mount.append(line(T("h1", "メモの詳細", "page-heading"),
      T("span", ticket.completedAt ? "完了" : "未完了", "ticket-state")));
    const card = E("section", { class: "ticket-panel" });
    const title = input("text", "", ticket.title);
    title.maxLength = 150;
    const note = area("受付内容や補足（任意）", ticket.note, 3);
    note.maxLength = MAX_NOTE;
    const due = input("date", "", ticket.dueDate);
    const tags = input("text", "例：入札, 申請, システム", ticket.tags.join(", "));
    tags.maxLength = 600;
    const finalAnswer = area("回答内容・結果（任意）", ticket.finalAnswer, 3);
    finalAnswer.maxLength = MAX_ANSWER;
    const refs = area("根拠資料名・参照先など（任意）", ticket.references, 2);
    refs.maxLength = MAX_REFS;
    card.append(field("件名", title), field("メモ", note), field("期限（任意）", due),
      field("タグ（カンマ区切り・任意）", tags),
      field("最終回答・対応結果（任意）", finalAnswer),
      field("参考情報（任意）", refs));
    card.append(B("変更を保存", "ticket-main ticket-full", () => {
      const newTags = [...new Set(tags.value.split(",").map((s) => s.trim()).filter(Boolean))];
      if (!title.value.trim() || title.value.trim().length > 150) {
        api.notify("件名を150文字以内で入力してください。"); return;
      }
      if (newTags.length > MAX_TAGS_PER_TICKET || newTags.some((s) => s.length > MAX_TAG_LENGTH)) {
        api.notify("タグは12個まで、1つ40文字以内にしてください。"); return;
      }
      if (!isDate(due.value)) { api.notify("期限の日付が正しくありません。"); return; }
      ticket.title = title.value.trim();
      ticket.note = note.value.trim();
      ticket.dueDate = due.value;
      ticket.tags = newTags;
      ticket.finalAnswer = finalAnswer.value.trim();
      ticket.references = refs.value.trim();
      ticket.updatedAt = new Date().toISOString();
      saveAndRedraw("変更を保存しました");
    }));
    mount.append(card);
    mount.append(E("h2", { class: "ticket-heading", text: "対応履歴（" + ticket.history.length + "件）" }));
    const history = E("div", { class: "ticket-history" });
    for (const event of ticket.history) {
      history.append(E("div", { class: "ticket-history-entry" }, [
        T("time", dateTime(event.createdAt)), T("p", event.text)
      ]));
    }
    if (!ticket.history.length) history.append(T("p", "対応履歴はまだありません。", "ticket-muted"));
    mount.append(history);
    const historyForm = E("section", { class: "ticket-panel" });
    const historyInput = area("調査・確認・電話対応などを追記", "", 3);
    historyInput.setAttribute("data-history-editor", "");
    historyInput.maxLength = MAX_HISTORY_TEXT;
    historyForm.append(field("＋ 対応履歴を追加", historyInput));
    historyForm.append(B("履歴を保存", "ticket-secondary ticket-full", () => {
      const value = historyInput.value.trim();
      if (!value) { api.notify("追記内容を入力してください。"); return; }
      if (ticket.history.length >= MAX_HISTORY) {
        api.notify("対応履歴の登録上限に達しました。"); return;
      }
      const now = new Date().toISOString();
      ticket.history.push({ id: crypto.randomUUID(), createdAt: now, text: value });
      ticket.updatedAt = now;
      view.addHistory = false;
      saveAndRedraw("対応履歴を追加しました");
    }));
    mount.append(historyForm);
    mount.append(T("p", "登録 " + dateTime(ticket.createdAt) +
      (ticket.completedAt ? " ／ 完了 " + dateTime(ticket.completedAt) : ""), "ticket-muted"));
    mount.append(line(
      B(ticket.knowledge ? "★ ナレッジ候補" : "☆ ナレッジ候補にする",
        ticket.knowledge ? "ticket-knowledge-on" : "ticket-secondary", () => toggleKnowledge(ticket)),
      B(ticket.completedAt ? "未完了に戻す" : "✓ 対応完了",
        ticket.completedAt ? "ticket-secondary" : "ticket-main", () => toggleDone(ticket))
    ));
    mount.append(T("p", "完了時に確認や回答入力は求めません。必要なら完了後も追記できます。", "ticket-muted"));
    mount.append(B("このメモを削除", "ticket-danger", () => {
      if (!confirm("このメモと対応履歴を削除します。元に戻せません。削除しますか？")) return;
      api.state.tasks = currentTickets().filter((item) => item.id !== ticket.id);
      view.screen = "list";
      saveAndRedraw("メモを削除しました");
    }));
  }
  function chooseExportTickets(tickets, options) {
    return tickets.filter((ticket) => {
      if (options.scope === "knowledge" && (!ticket.knowledge || !ticket.completedAt)) return false;
      if (options.scope === "done" && !ticket.completedAt) return false;
      const date = localDate(ticket.createdAt);
      if (options.from && date < options.from) return false;
      if (options.to && date > options.to) return false;
      return true;
    });
  }
  function exportRecord(ticket, options) {
    return {
      id: ticket.id, title: ticket.title, createdAt: ticket.createdAt,
      completedAt: ticket.completedAt, dueDate: ticket.dueDate,
      note: ticket.note, tags: ticket.tags, knowledge: ticket.knowledge,
      ...(options.includeHistory ? { history: ticket.history } : {}),
      ...(options.includeAnswer ? { finalAnswer: ticket.finalAnswer } : {}),
      ...(options.includeReferences ? { references: ticket.references } : {})
    };
  }
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csvOf(records) {
    const keys = ["id", "title", "createdAt", "completedAt", "dueDate", "note", "tags",
      "knowledge", "history", "finalAnswer", "references"];
    const included = keys.filter((key) => records.some((r) => Object.prototype.hasOwnProperty.call(r, key))
      || ["id", "title", "createdAt", "completedAt", "dueDate", "note", "tags", "knowledge"].includes(key));
    const rows = [included.map(csvCell).join(",")];
    for (const item of records) {
      rows.push(included.map((key) => csvCell(
        key === "history" ? (item.history || []).map((h) => dateTime(h.createdAt) + " " + h.text).join("\n")
          : key === "tags" ? (item.tags || []).join(", ")
          : key === "knowledge" ? (item.knowledge ? "はい" : "いいえ")
          : item[key] ?? ""
      )).join(","));
    }
    return "\uFEFF" + rows.join("\r\n") + "\r\n";
  }
  function mdOf(records) {
    let md = "# メモ・タスク 対応記録\n\n";
    md += "出力日時：" + dateTime(new Date().toISOString()) + "\n";
    md += "記録数：" + records.length + "件\n\n";
    md += "> 過去の対応記録です。現行制度や正式回答とは限りません。外部AIに渡す前に個人情報・機密情報を確認してください。\n\n";
    for (const item of records) {
      md += "---\n\n## " + item.title.replace(/\n/g, " ") + "\n\n";
      md += "- ID: " + item.id + "\n- 登録: " + dateTime(item.createdAt);
      md += "\n- 状態: " + (item.completedAt ? "完了" : "未完了");
      md += item.completedAt ? "\n- 完了: " + dateTime(item.completedAt) : "";
      md += item.dueDate ? "\n- 期限: " + item.dueDate : "";
      md += "\n- ナレッジ候補: " + (item.knowledge ? "はい" : "いいえ");
      md += "\n- タグ: " + (item.tags.join(", ") || "なし") + "\n\n";
      md += "### 受付内容・メモ\n\n" + (item.note || "（未記録）") + "\n\n";
      if ("history" in item) {
        md += "### 対応履歴\n\n";
        md += item.history.length ? item.history.map((h) => "- " + dateTime(h.createdAt) + "　" + h.text.replace(/\n/g, "\n  ")).join("\n") : "（未記録）";
        md += "\n\n";
      }
      if ("finalAnswer" in item) md += "### 最終回答・対応結果\n\n" + (item.finalAnswer || "（未記録）") + "\n\n";
      if ("references" in item) md += "### 参考情報\n\n" + (item.references || "（未記録）") + "\n\n";
    }
    return md;
  }
  function serializeTickets(tickets, options) {
    const chosen = chooseExportTickets(tickets, options);
    const records = chosen.map((ticket) => exportRecord(ticket, options));
    if (options.format === "csv") return { content: csvOf(records), mime: "text/csv;charset=utf-8", count: records.length };
    if (options.format === "json") return {
      content: JSON.stringify({ format: "urachan-knowledge-export", version: 1, createdAt: new Date().toISOString(), items: records }, null, 2) + "\n",
      mime: "application/json;charset=utf-8", count: records.length
    };
    return { content: mdOf(records), mime: "text/markdown;charset=utf-8", count: records.length };
  }
  function download(filename, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = E("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function renderExport() {
    mount.append(B("← 一覧へ", "ticket-link", () => { view.screen = "list"; redraw(); }));
    mount.append(T("h1", "記録の出力", "page-heading"));
    mount.append(T("p", "AIでQ&Aを作る場合は、完了済みのナレッジ候補をMarkdownで出力するのがおすすめです。", "explain"));
    const block = E("section", { class: "ticket-panel" });
    const scope = E("select", { class: "ticket-input" }, [
      E("option", { value: "knowledge", text: "★ ナレッジ候補（完了分）" }),
      E("option", { value: "done", text: "完了した記録すべて" }),
      E("option", { value: "all", text: "すべての記録" })
    ]);
    scope.value = view.exportScope;
    scope.addEventListener("change", () => { view.exportScope = scope.value; updateCount(); });
    const format = E("select", { class: "ticket-input" }, [
      E("option", { value: "md", text: "Markdown（AI用）" }),
      E("option", { value: "csv", text: "CSV（Excel用）" }),
      E("option", { value: "json", text: "JSON（データ活用用）" })
    ]);
    format.value = view.exportFormat;
    format.addEventListener("change", () => { view.exportFormat = format.value; });
    const from = input("date", "", view.exportFrom), to = input("date", "", view.exportTo);
    from.addEventListener("change", () => { view.exportFrom = from.value; updateCount(); });
    to.addEventListener("change", () => { view.exportTo = to.value; updateCount(); });
    block.append(field("出力対象", scope), field("出力形式", format),
      T("p", "登録日で絞り込み（任意）", "ticket-muted"), line(field("開始日", from), field("終了日", to)));
    const opt = (title, key) => {
      const box = E("input", { type: "checkbox", checked: view[key] });
      box.addEventListener("change", () => { view[key] = box.checked; });
      return E("label", { class: "ticket-check-label" }, [box, title]);
    };
    block.append(opt("対応履歴を含める", "includeHistory"),
      opt("最終回答・対応結果を含める", "includeAnswer"),
      opt("参考情報を含める", "includeReferences"));
    const count = T("p", "", "ticket-count");
    function updateCount() {
      const chosen = chooseExportTickets(currentTickets(), {
        scope: view.exportScope, from: view.exportFrom, to: view.exportTo
      });
      count.textContent = "対象 " + chosen.length + "件";
    }
    updateCount();
    block.append(count);
    block.append(B("ファイルを出力", "ticket-main ticket-full", () => {
      if (view.exportFrom && view.exportTo && view.exportFrom > view.exportTo) {
        api.notify("期間の開始日と終了日を確認してください。"); return;
      }
      const options = {
        scope: view.exportScope, format: view.exportFormat, from: view.exportFrom, to: view.exportTo,
        includeHistory: view.includeHistory, includeAnswer: view.includeAnswer,
        includeReferences: view.includeReferences
      };
      const result = serializeTickets(currentTickets(), options);
      if (!result.count) { api.notify("対象となる記録がありません。"); return; }
      download("urachan-knowledge-" + today() + "." + view.exportFormat, result.content, result.mime);
      api.notify(result.count + "件を出力しました");
    }));
    mount.append(block);
    mount.append(T("p", "注意：外部AIへ渡す前に個人情報・機密情報を確認し、組織で認められた環境で利用してください。正式なQ&Aとして利用する前に回答内容を確認してください。", "ticket-warning"));
  }
  function renderInto() {
    mount.replaceChildren();
    if (view.screen === "detail") renderDetail();
    else if (view.screen === "export") renderExport();
    else renderList();
  }
  function render(main, context) {
    mount = main; api = context;
    renderInto();
  }
  window.UraTaskTools = { render, validateTickets, createTicket, chooseExportTickets, serializeTickets };
})();
