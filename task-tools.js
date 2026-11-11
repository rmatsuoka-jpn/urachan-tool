"use strict";

// メモ・タスク：閉域・ローカル保存専用。業務ページ本文の取得や外部送信は行わない。
(function () {
  const MAX_TASKS = 1000;
  const MAX_HISTORY = 100;
  const MAX_TITLE = 120;
  const MAX_MEMO = 6000;
  const MAX_ANSWER = 6000;
  const MAX_REFERENCE = 4000;
  const MAX_HISTORY_TEXT = 4000;
  let selectedId = null;
  let addHistoryNow = false;
  let query = "";
  let statusFilter = "open";
  let sortOrder = "recent";
  let knowledgeFilter = false;
  let exportOpen = false;
  let exportFormat = "md";
  let exportScope = "done";
  let exportKnowledgeOnly = false;
  let detailEditor = null;

  function validTime(s) {
    return typeof s === "string" && s.length <= 40 && Number.isFinite(Date.parse(s));
  }
  function validDate(s) {
    if (s === "") return true;
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function validText(s, max, required = false) {
    return typeof s === "string" && s.length <= max && (!required || s.trim().length > 0);
  }
  function validate(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.items) ||
      data.items.length > MAX_TASKS || !Number.isSafeInteger(data.nextNumber) ||
      data.nextNumber < 1) throw Error("メモ・タスクの保存形式が正しくありません。");
    const ids = new Set();
    const numbers = new Set();
    const items = data.items.map((item) => {
      if (!item || typeof item.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) || ids.has(item.id) ||
        !Number.isSafeInteger(item.number) || item.number < 1 || numbers.has(item.number) ||
        !validText(item.title, MAX_TITLE, true) ||
        !validText(item.memo, MAX_MEMO) ||
        !validText(item.finalAnswer, MAX_ANSWER) ||
        !validText(item.references, MAX_REFERENCE) ||
        !validDate(item.dueDate) ||
        !validTime(item.createdAt) || !validTime(item.updatedAt) ||
        !(item.completedAt === null || validTime(item.completedAt)) ||
        typeof item.knowledgeCandidate !== "boolean" ||
        !Array.isArray(item.history) || item.history.length > MAX_HISTORY) {
        throw Error("メモ・タスクの項目に不正な値があります。");
      }
      ids.add(item.id);
      numbers.add(item.number);
      const historyIds = new Set();
      const history = item.history.map((entry) => {
        if (!entry || typeof entry.id !== "string" ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(entry.id) || historyIds.has(entry.id) ||
          !validTime(entry.at) || !validText(entry.text, MAX_HISTORY_TEXT, true)) {
          throw Error("対応履歴に不正な値があります。");
        }
        historyIds.add(entry.id);
        return { id: entry.id, at: entry.at, text: entry.text };
      });
      return {
        id: item.id, number: item.number, title: item.title,
        memo: item.memo, finalAnswer: item.finalAnswer,
        references: item.references, dueDate: item.dueDate,
        createdAt: item.createdAt, updatedAt: item.updatedAt,
        completedAt: item.completedAt, knowledgeCandidate: item.knowledgeCandidate,
        history
      };
    });
    if (items.some((item) => item.number >= data.nextNumber)) {
      throw Error("メモ・タスクの番号情報が正しくありません。");
    }
    return { version: 1, nextNumber: data.nextNumber, items };
  }
  function emptyData() {
    return { version: 1, nextNumber: 1, items: [] };
  }
  function localDate(date = new Date()) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") +
      "-" + String(date.getDate()).padStart(2, "0");
  }
  function ticketNo(item) {
    return "T-" + String(item.number).padStart(6, "0");
  }
  function stamp(iso) {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  }

  // 一覧には最終回答を優先し、回答がなければ日時が最も新しい履歴を表示する。
  function latestPreview(item) {
    if (item.finalAnswer.trim()) return { label: "最終回答・結果", text: item.finalAnswer.trim() };
    const latest = item.history.reduce((result, entry) =>
      !result || entry.at >= result.at ? entry : result, null);
    return latest ? { label: "最新の対応履歴", text: latest.text } : null;
  }
  function hasUnsavedDetail() {
    const editor = detailEditor;
    if (!selectedId || !editor || editor.item.id !== selectedId) return false;
    const { item, title, memo, due, answer, references, historyInput } = editor;
    return title.value !== item.title || memo.value !== item.memo ||
      due.value !== item.dueDate || answer.value !== item.finalAnswer ||
      references.value !== item.references || Boolean(historyInput?.value.trim());
  }
  function confirmLeave() {
    if (hasUnsavedDetail() && !confirm("未保存の変更があります。保存せずに移動しますか？")) return false;
    selectedId = null;
    addHistoryNow = false;
    detailEditor = null;
    return true;
  }

  function inScope(items, scope, knowledgeOnly) {
    return items.filter((item) =>
      (scope === "all" || (scope === "done" ? item.completedAt !== null : item.completedAt === null)) &&
      (!knowledgeOnly || item.knowledgeCandidate));
  }
  function csvCell(value) {
    let s = String(value ?? "");
    // Excelでの数式解釈を防ぐ。外部由来のメモも出力対象になりうる。
    if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function makeExport(data, format, scope, knowledgeOnly) {
    const items = inScope(validate(data).items, scope, knowledgeOnly);
    const fields = ["ID", "件名", "メモ", "状態", "登録日時", "更新日時", "完了日時",
      "期限", "ナレッジ候補", "対応履歴", "最終回答・対応結果", "参考情報"];
    const rows = items.map((item) => [
      ticketNo(item), item.title, item.memo,
      item.completedAt ? "完了" : "未完了", item.createdAt, item.updatedAt,
      item.completedAt || "", item.dueDate, item.knowledgeCandidate ? "はい" : "いいえ",
      item.history.map((h) => stamp(h.at) + " " + h.text).join("\n"),
      item.finalAnswer, item.references
    ]);
    if (format === "csv") {
      return { extension: "csv", mime: "text/csv;charset=utf-8",
        content: "\uFEFF" + [fields, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n",
        count: items.length };
    }
    if (format === "json") {
      return { extension: "json", mime: "application/json;charset=utf-8",
        content: JSON.stringify({
          format: "urachan-task-export", version: 1, exportedAt: new Date().toISOString(),
          items
        }, null, 2) + "\n", count: items.length };
    }
    if (format !== "md") throw Error("対応していない出力形式です。");
    const lines = ["# メモ・タスク 対応記録", "",
      "出力日時：" + stamp(new Date().toISOString()), "",
      "※これは過去の対応記録です。正式なFAQとして利用する前に内容・制度の現行性を確認してください。", ""];
    for (const item of items) {
      lines.push("## " + ticketNo(item) + " " + item.title.replace(/[\r\n]/g, " "),
        "", "- 状態：" + (item.completedAt ? "完了" : "未完了"),
        "- 登録日時：" + stamp(item.createdAt),
        "- 完了日時：" + (item.completedAt ? stamp(item.completedAt) : "未完了"),
        "- 期限：" + (item.dueDate || "なし"),
        "- ナレッジ候補：" + (item.knowledgeCandidate ? "はい" : "いいえ"),
        "", "### 受付・メモ", "", item.memo || "（記録なし）",
        "", "### 対応履歴", "");
      if (!item.history.length) lines.push("（記録なし）");
      for (const h of item.history) lines.push("- " + stamp(h.at) + "：" + h.text.replace(/\n/g, "\n  "));
      lines.push("", "### 最終回答・対応結果", "", item.finalAnswer || "（記録なし）",
        "", "### 参考情報", "", item.references || "（記録なし）", "", "---", "");
    }
    return { extension: "md", mime: "text/markdown;charset=utf-8", content: lines.join("\n"), count: items.length };
  }
  function download(content, mime, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "class") node.className = value;
      else if (name === "text") node.textContent = value;
      else if (name === "checked") node.checked = Boolean(value);
      else if (name === "value") node.value = value;
      else if (name === "disabled") node.disabled = Boolean(value);
      else if (name.startsWith("on") && typeof value === "function") {
        node.addEventListener(name.slice(2).toLowerCase(), value);
      } else if (value !== null && value !== undefined) node.setAttribute(name, String(value));
    }
    for (const child of (Array.isArray(children) ? children : [children])) {
      if (child !== null && child !== undefined) {
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    }
    return node;
  }
  function button(label, kind, action) {
    return el("button", { type: "button", class: "button " + kind, onClick: action }, label);
  }
  function note(ctx, message) {
    void ctx.persist().then(() => ctx.notify(message)).catch(() => {});
    ctx.render();
  }
  function buttonLabel(label, input) {
    return el("label", { class: "task-field" }, [
      el("span", { class: "task-field-label", text: label }), input
    ]);
  }
  function textInput(placeholder, value = "") {
    return el("input", { type: "text", class: "task-input", placeholder, value });
  }
  function textArea(placeholder, value = "", rows = 3) {
    return el("textarea", { class: "task-textarea", placeholder, rows, value, text: value });
  }
  function select(options, value, onChange, label) {
    const input = el("select", { class: "task-select", "aria-label": label, onChange });
    options.forEach(([id, name]) => input.append(el("option", { value: id, text: name })));
    input.value = value;
    return input;
  }

  function starButton(ctx, item, withLabel = false, afterChange = null) {
    const control = button("", "task-star", () => {
      item.knowledgeCandidate = !item.knowledgeCandidate;
      item.updatedAt = new Date().toISOString();
      refresh();
      void ctx.persist().then(() =>
        ctx.notify(item.knowledgeCandidate ? "ナレッジ候補に設定しました" : "ナレッジ候補を解除しました")
      ).catch(() => {});
      if (afterChange) afterChange();
    });
    function refresh() {
      const marked = item.knowledgeCandidate;
      control.textContent = (marked ? "★" : "☆") + (withLabel ? " ナレッジ候補" : "");
      control.classList.toggle("active", marked);
      control.setAttribute("aria-pressed", String(marked));
      control.setAttribute("aria-label", (marked ? "ナレッジ候補を解除：" : "ナレッジ候補に設定：") + item.title);
      control.title = marked ? "ナレッジ候補を解除" : "ナレッジ候補に設定";
    }
    refresh();
    return control;
  }

  function openDetail(ctx, id, focusHistory = false) {
    selectedId = id;
    detailEditor = null;
    addHistoryNow = focusHistory;
    ctx.render();
    if (focusHistory) document.getElementById("task-history-input")?.focus();
  }
  function toggleDone(ctx, item) {
    const oldValue = item.completedAt;
    item.completedAt = oldValue ? null : new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    const newValue = item.completedAt;
    // 一覧からは即時に完了。通知の「元に戻す」で取り消せる。
    void ctx.persist().then(() => ctx.notify(newValue ? "完了しました" : "未完了に戻しました", () => {
      item.completedAt = oldValue;
      item.updatedAt = new Date().toISOString();
      void ctx.persist();
      ctx.render();
    })).catch(() => {});
    ctx.render();
  }
  function createTask(ctx, title, memo = "") {
    if (!title.trim()) { ctx.notify("件名を入力してください。"); return; }
    if (title.length > MAX_TITLE || memo.length > MAX_MEMO) {
      ctx.notify("件名またはメモが長すぎます。"); return;
    }
    const tasks = ctx.state.tasks;
    if (tasks.items.length >= MAX_TASKS) {
      ctx.notify("登録件数の上限に達しました。"); return;
    }
    const now = new Date().toISOString();
    tasks.items.unshift({
      id: crypto.randomUUID(), number: tasks.nextNumber++, title: title.trim(),
      memo: memo.trim(), createdAt: now, updatedAt: now,
      dueDate: "", completedAt: null, history: [], finalAnswer: "",
      references: "", knowledgeCandidate: false
    });
    note(ctx, "メモを登録しました");
  }
  function renderList(main, ctx) {
    detailEditor = null;
    const tasks = ctx.state.tasks.items;
    const header = el("div", { class: "task-heading" }, [
      el("strong", { text: "メモ・タスク" }),
      el("span", { class: "task-muted", text: "未完了 " + tasks.filter((t) => !t.completedAt).length + "件" })
    ]);
    main.append(header);
    const quick = el("section", { class: "task-quick" });
    const title = textInput("やること・問い合わせ内容を入力");
    title.maxLength = MAX_TITLE;
    const add = () => createTask(ctx, title.value);
    title.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); add(); }
    });
    quick.append(title, button("＋ 登録", "button-primary", add));
    main.append(quick);

    const search = el("input", {
      type: "search", class: "task-input", value: query,
      placeholder: "件名・メモ・回答から検索", "aria-label": "メモ・タスクを検索"
    });
    const selectStatus = select([
      ["open", "未完了"], ["done", "完了"], ["all", "すべて"]
    ], statusFilter, (ev) => { statusFilter = ev.target.value; updateRows(); }, "表示状態");
    const selectSort = select([
      ["recent", "更新が新しい順"], ["due", "期限が近い順"]
    ], sortOrder, (ev) => { sortOrder = ev.target.value; updateRows(); }, "並び順");
    const onlyKnowledge = el("label", { class: "task-check-label" }, [
      el("input", { type: "checkbox", checked: knowledgeFilter,
        onChange: (ev) => { knowledgeFilter = ev.target.checked; updateRows(); } }),
      "★ ナレッジ候補のみ"
    ]);
    const controls = el("div", { class: "task-controls" }, [
      search, el("div", { class: "task-controls-row" }, [selectStatus, selectSort]), onlyKnowledge
    ]);
    main.append(controls);
    const list = el("div", { class: "task-list" });
    main.append(list);
    search.addEventListener("input", () => { query = search.value; updateRows(); });

    function updateRows() {
      list.replaceChildren();
      const needle = query.trim().toLocaleLowerCase("ja-JP");
      const shown = tasks.filter((item) =>
        (statusFilter === "all" || (statusFilter === "done" ? item.completedAt !== null : item.completedAt === null)) &&
        (!knowledgeFilter || item.knowledgeCandidate) &&
        (!needle || [item.title, item.memo, item.finalAnswer, item.references,
          ...item.history.map((h) => h.text)].some((v) => v.toLocaleLowerCase("ja-JP").includes(needle))));
      shown.sort((a, b) => {
        if (sortOrder === "due") {
          if (!a.dueDate) return b.dueDate ? 1 : b.updatedAt.localeCompare(a.updatedAt);
          if (!b.dueDate) return -1;
          const compared = a.dueDate.localeCompare(b.dueDate);
          if (compared) return compared;
        }
        return b.updatedAt.localeCompare(a.updatedAt);
      });
      if (!shown.length) {
        list.append(el("p", { class: "task-empty", text: tasks.length ? "該当するメモはありません。" :
          "まだメモがありません。上の欄から登録してください。" }));
        return;
      }
      for (const item of shown) {
        const overdue = !item.completedAt && item.dueDate && item.dueDate < localDate();
        const dueToday = !item.completedAt && item.dueDate === localDate();
        const name = el("button", { type: "button", class: "task-name", onClick: () => openDetail(ctx, item.id) },
          [el("span", { text: item.title }), el("span", { class: "task-muted",
            text: ticketNo(item) + " · 履歴" + item.history.length + "件" })]);
        const header = el("div", { class: "task-item-header" }, [
          name, starButton(ctx, item, false, () => { if (knowledgeFilter) updateRows(); })
        ]);
        const row = el("div", { class: "task-item" }, [header]);
        const preview = latestPreview(item);
        if (preview) {
          row.append(el("div", { class: "task-preview" }, [
            el("span", { class: "task-preview-label", text: preview.label }),
            el("div", { class: "task-preview-text", text: preview.text })
          ]));
        }
        if (item.dueDate) row.append(el("div", {
          class: overdue ? "task-overdue task-due" : dueToday ? "task-today task-due" : "task-muted task-due",
          text: (overdue ? "期限超過 " : "期限 ") + item.dueDate
        }));
        const checked = el("input", { type: "checkbox", class: "task-complete",
          checked: Boolean(item.completedAt),
          "aria-label": item.title + (item.completedAt ? "を未完了に戻す" : "を完了にする"),
          onChange: () => toggleDone(ctx, item)
        });
        const done = el("label", { class: "task-complete-label" }, [checked, el("span", { text: "完了" })]);
        row.append(el("div", { class: "task-item-footer" }, [
          done,
          el("div", { class: "task-item-actions" }, [
            button("＋ 追記", "button-secondary", () => openDetail(ctx, item.id, true)),
            button("詳細", "button-plain", () => openDetail(ctx, item.id))
          ])
        ]));
        list.append(row);
      }
    }
    updateRows();
    main.append(button(exportOpen ? "出力設定を閉じる" : "記録を書き出す", "button-secondary full", () => {
      exportOpen = !exportOpen; ctx.render();
    }));
    if (exportOpen) renderExport(main, ctx);
  }
  function renderExport(main, ctx) {
    const box = el("section", { class: "task-export" });
    box.append(el("strong", { text: "AI・Excel向け出力" }),
      el("p", { class: "task-muted", text: "外部AIへ送る場合は個人情報・機密情報を除去し、組織の利用ルールを確認してください。" }));
    box.append(buttonLabel("形式", select([
      ["md", "Markdown（AI向け）"], ["csv", "CSV（Excel向け）"], ["json", "JSON（記録データ）"]
    ], exportFormat, (ev) => { exportFormat = ev.target.value; }, "出力形式")));
    box.append(buttonLabel("対象", select([
      ["done", "完了のみ"], ["open", "未完了のみ"], ["all", "すべて"]
    ], exportScope, (ev) => { exportScope = ev.target.value; }, "出力対象")));
    box.append(el("label", { class: "task-check-label" }, [
      el("input", { type: "checkbox", checked: exportKnowledgeOnly,
        onChange: (ev) => { exportKnowledgeOnly = ev.target.checked; } }),
      "★ ナレッジ候補だけを出力"
    ]));
    box.append(button("ファイルを出力", "button-primary full", () => {
      try {
        const result = makeExport(ctx.state.tasks, exportFormat, exportScope, exportKnowledgeOnly);
        if (!result.count) { ctx.notify("出力対象のメモがありません。"); return; }
        download(result.content, result.mime, "urachan-tasks-" + localDate() + "." + result.extension);
        ctx.notify(result.count + "件のファイル出力を開始しました");
      } catch (error) {
        ctx.notify("出力できませんでした：" + error.message);
      }
    }));
    main.append(box);
  }
  function renderDetail(main, ctx, item) {
    const back = button("← 一覧に戻る", "button-plain task-back", () => {
      if (!confirmLeave()) return;
      ctx.render();
    });
    main.append(back);
    main.append(el("div", { class: "task-detail-heading" }, [
      el("strong", { text: ticketNo(item) }),
      el("span", { class: "task-muted", text: "登録：" + stamp(item.createdAt) })
    ]));

    const title = textInput("件名", item.title);
    title.maxLength = MAX_TITLE;
    const memo = textArea("受付内容・作業内容", item.memo, 3);
    memo.maxLength = MAX_MEMO;
    const due = el("input", { type: "date", class: "task-input", value: item.dueDate });
    const answer = textArea("最終回答・対応結果", item.finalAnswer, 3);
    answer.maxLength = MAX_ANSWER;
    const references = textArea("資料名・参考URLなど", item.references, 2);
    references.maxLength = MAX_REFERENCE;
    detailEditor = { item, title, memo, due, answer, references, historyInput: null };

    const saveFields = (showToast = false) => {
      if (!title.value.trim() || title.value.length > MAX_TITLE || memo.value.length > MAX_MEMO ||
          answer.value.length > MAX_ANSWER || references.value.length > MAX_REFERENCE ||
          !validDate(due.value)) {
        ctx.notify("入力内容を確認してください。件名は必須です。");
        return false;
      }
      // 保存値と入力値をそろえ、余分な空白による誤った未保存警告を防ぐ。
      title.value = title.value.trim();
      const changed = item.title !== title.value || item.memo !== memo.value ||
        item.dueDate !== due.value || item.finalAnswer !== answer.value ||
        item.references !== references.value;
      if (changed) {
        Object.assign(item, {
          title: title.value.trim(), memo: memo.value, dueDate: due.value,
          finalAnswer: answer.value, references: references.value,
          updatedAt: new Date().toISOString()
        });
        void ctx.persist().then(() => { if (showToast) ctx.notify("変更を保存しました"); }).catch(() => {});
      } else if (showToast) ctx.notify("変更はありません");
      return true;
    };

    const done = el("input", { type: "checkbox", class: "task-complete", checked: Boolean(item.completedAt),
      "aria-label": "完了", onChange: () => {
        const reject = () => { done.checked = Boolean(item.completedAt); };
        if (detailEditor?.historyInput?.value.trim()) {
          ctx.notify("入力中の対応履歴を先に保存してください。");
          reject();
          return;
        }
        if (hasUnsavedDetail() &&
            !confirm("編集中の基本情報と回答を保存し、完了状態を切り替えますか？")) {
          reject();
          return;
        }
        if (!saveFields()) { reject(); return; }
        toggleDone(ctx, item);
      }
    });
    const status = el("div", { class: "task-detail-status" }, [
      el("label", { class: "task-complete-label" }, [done, el("span", { text: "完了" })]),
      starButton(ctx, item, true)
    ]);
    main.append(status);

    main.append(el("section", { class: "task-detail-section task-detail-info" }, [
      el("h2", { text: "基本情報" }),
      buttonLabel("件名", title),
      buttonLabel("メモ", memo),
      buttonLabel("期限（任意）", due)
    ]));
    main.append(el("section", { class: "task-detail-section task-detail-answer" }, [
      el("h2", { text: "回答・結果" }),
      buttonLabel("最終回答・対応結果", answer),
      buttonLabel("参考情報（任意）", references),
      button("変更を保存", "button-primary full", () => { saveFields(true); })
    ]));

    const history = el("section", { class: "task-detail-section task-detail-history" },
      [el("h2", { text: "対応履歴" })]);
    if (item.history.length) {
      const ordered = [...item.history].sort((a, b) => a.at.localeCompare(b.at));
      for (const entry of ordered) history.append(el("div", { class: "task-history" }, [
        el("span", { class: "task-muted", text: stamp(entry.at) }),
        el("p", { text: entry.text })
      ]));
    } else history.append(el("p", { class: "task-muted", text: "対応履歴はまだありません。" }));
    if (addHistoryNow) {
      const input = textArea("確認・連絡・作業したことを追記", "", 3);
      input.id = "task-history-input";
      input.maxLength = MAX_HISTORY_TEXT;
      detailEditor.historyInput = input;
      history.append(input, el("div", { class: "task-item-actions" }, [
        button("キャンセル", "button-plain", () => {
          if (input.value.trim() && !confirm("入力中の対応履歴を破棄しますか？")) return;
          addHistoryNow = false;
          if (!saveFields()) return;
          ctx.render();
        }),
        button("履歴を保存", "button-primary", () => {
          if (!input.value.trim()) { ctx.notify("履歴を入力してください。"); return; }
          if (item.history.length >= MAX_HISTORY) {
            ctx.notify("対応履歴の件数上限に達しました。"); return;
          }
          if (!saveFields()) return;
          item.history.push({ id: crypto.randomUUID(), at: new Date().toISOString(),
            text: input.value.trim() });
          item.updatedAt = new Date().toISOString();
          addHistoryNow = false;
          note(ctx, "対応履歴を追加しました");
        })
      ]));
    } else history.append(button("＋ 対応履歴を追加", "button-secondary full", () => {
      if (!saveFields()) return;
      addHistoryNow = true;
      ctx.render();
      document.getElementById("task-history-input")?.focus();
    }));
    main.append(history);
    main.append(button("このメモを削除", "button-plain full task-delete", () => {
      if (hasUnsavedDetail() && !confirm("未保存の変更があります。破棄して削除しますか？")) return;
      if (!confirm("このメモと対応履歴を削除します。元に戻せません。続けますか？")) return;
      ctx.state.tasks.items = ctx.state.tasks.items.filter((task) => task.id !== item.id);
      selectedId = null;
      detailEditor = null;
      addHistoryNow = false;
      note(ctx, "メモを削除しました");
    }));
  }
  function render(main, ctx) {
    if (!ctx.state.tasks) ctx.state.tasks = emptyData();
    const item = selectedId && ctx.state.tasks.items.find((entry) => entry.id === selectedId);
    if (item) renderDetail(main, ctx, item);
    else { selectedId = null; detailEditor = null; renderList(main, ctx); }
  }
  window.UraTasks = { render, validate, emptyData, makeExport, confirmLeave, hasUnsavedDetail,
    helpers: Object.freeze({ latestPreview }) };
})();
