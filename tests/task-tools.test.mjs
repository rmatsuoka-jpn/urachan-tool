import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "task-tools.js"), "utf8");
const sandbox = { window: {}, document: {}, Node: class {}, crypto: {}, URL, Blob, setTimeout };
vm.runInNewContext(source, sandbox);
const { emptyData, validate, makeExport } = sandbox.window.UraTasks;
const normalize = (value) => JSON.parse(JSON.stringify(value));

const now = "2026-11-11T04:30:00.000Z";
const sample = () => ({
  version: 1, nextNumber: 3, items: [{
    id: "task-a", number: 1, title: "申請について問い合わせ", memo: "確認後に折り返す",
    createdAt: now, updatedAt: now, completedAt: now, dueDate: "2026-11-13",
    knowledgeCandidate: true, finalAnswer: "提出期限を回答",
    references: "申請要領", history: [
      { id: "history-1", at: now, text: "担当部署に確認" },
      { id: "history-2", at: now, text: "折り返し電話" }
    ]
  }, {
    id: "task-b", number: 2, title: "会議資料を修正", memo: "",
    createdAt: now, updatedAt: now, completedAt: null, dueDate: "",
    knowledgeCandidate: false, finalAnswer: "", references: "", history: []
  }]
});

test("空の記録形式を読み込み、件名と履歴、完了日時を維持する", () => {
  const empty = normalize(emptyData());
  assert.equal(empty.items.length, 0);
  assert.equal(empty.nextNumber, 1);
  const data = normalize(validate(sample()));
  assert.equal(data.items[0].history.length, 2);
  assert.equal(data.items[0].completedAt, now);
  assert.equal(data.items[1].completedAt, null);
});

test("重複番号・ID・履歴、誤った期限を拒否", () => {
  const duplicates = sample();
  duplicates.items[1].number = 1;
  assert.throws(() => validate(duplicates));
  duplicates.items[1].number = 2;
  duplicates.items[1].id = "task-a";
  assert.throws(() => validate(duplicates));
  duplicates.items[1].id = "task-b";
  duplicates.items[0].history[1].id = "history-1";
  assert.throws(() => validate(duplicates));
  duplicates.items[0].history[1].id = "history-2";
  duplicates.items[0].dueDate = "2026-02-30";
  assert.throws(() => validate(duplicates));
});

test("番号が繰り返されず、件数や入力長の上限を検証", () => {
  const data = sample();
  data.nextNumber = 2;
  assert.throws(() => validate(data));
  data.nextNumber = 3;
  data.items[0].title = "";
  assert.throws(() => validate(data));
  data.items[0].title = "申請";
  data.items[0].history[0].text = "";
  assert.throws(() => validate(data));
  data.items[0].history[0].text = "確認";
  data.items[0].finalAnswer = "a".repeat(6001);
  assert.throws(() => validate(data));
});

test("Markdownに履歴・最終回答・参考情報を含める", () => {
  const result = makeExport(sample(), "md", "done", false);
  assert.equal(result.count, 1);
  assert.match(result.content, /T-000001/);
  assert.match(result.content, /担当部署に確認/);
  assert.match(result.content, /提出期限を回答/);
  assert.match(result.content, /申請要領/);
  assert.doesNotMatch(result.content, /会議資料を修正/);
});

test("未完了、完了、★候補の出力絞り込み", () => {
  assert.equal(makeExport(sample(), "json", "open", false).count, 1);
  assert.equal(makeExport(sample(), "json", "done", true).count, 1);
  assert.equal(makeExport(sample(), "json", "open", true).count, 0);
  assert.equal(makeExport(sample(), "json", "all", false).count, 2);
  const data = JSON.parse(makeExport(sample(), "json", "all", false).content);
  assert.equal(data.format, "urachan-task-export");
  assert.equal(data.items[0].history.length, 2);
});

test("CSVの引用符・改行・Excel数式を保護", () => {
  const data = sample();
  data.items[0].memo = '=HYPERLINK("bad","click")\n二行目';
  const csv = makeExport(data, "csv", "done", false).content;
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"'=HYPERLINK\(""bad"",""click""\)/);
  assert.match(csv, /二行目/);
});

test("追加のChrome権限やネットワーク通信に依存しない", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const html = readFileSync(join(root, "panel.html"), "utf8");
  const panel = readFileSync(join(root, "panel.js"), "utf8");
  assert.match(html, /task-tools\.js/);
  assert.match(panel, /\{ id: "tasks", name: "メモ・タスク"/);
  assert.match(panel, /UraTasks\.render/);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.permissions.includes("notifications"), false);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
});
