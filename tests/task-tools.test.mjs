// 実行方法: node --test tests/task-tools.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const code = readFileSync(path.join(base, "task-tools.js"), "utf8");
const sandbox = { window: {}, console, Date, crypto: { randomUUID: () => "test-id-1" } };
vm.runInNewContext(code, sandbox);
const { createTicket, validateTickets, chooseExportTickets, serializeTickets } = sandbox.window.UraTaskTools;
const now = "2026-11-11T08:30:00.000Z";
const plain = () => JSON.parse(JSON.stringify(createTicket("会議資料を作成", "", now, "task-1")));
const outputOptions = (changes = {}) => ({
  scope: "all", format: "md", from: "", to: "",
  includeHistory: true, includeAnswer: true, includeReferences: true, ...changes
});

test("件名だけで登録でき、日時・状態の初期値が正しい", () => {
  const t = plain();
  assert.equal(t.title, "会議資料を作成");
  assert.equal(t.createdAt, now);
  assert.equal(t.completedAt, null);
  assert.equal(t.history.length, 0);
  assert.equal(t.finalAnswer, "");
  assert.equal(t.dueDate, "");
  assert.equal(t.knowledge, false);
  assert.equal(validateTickets([t])[0].title, t.title);
});
test("空件名や長すぎる件名は拒否", () => {
  assert.throws(() => createTicket(" "), /件名/);
  assert.throws(() => createTicket("x".repeat(151)), /件名/);
});
test("対応履歴は日時付きで複数件蓄積でき、復元時に検証される", () => {
  const t = plain();
  t.history = [
    { id: "log1", createdAt: now, text: "問い合わせを受けた。" },
    { id: "log2", createdAt: "2026-11-12T10:20:00.000Z", text: "回答を行った。" }
  ];
  t.finalAnswer = "申請手順を案内した。";
  const checked = validateTickets([t]);
  assert.equal(checked[0].history.length, 2);
  assert.equal(checked[0].finalAnswer, t.finalAnswer);
  t.history[1].id = "log1";
  assert.throws(() => validateTickets([t]), /対応履歴/);
});
test("不正な日付・重複ID・壊れたナレッジ設定を拒否する", () => {
  const t = plain();
  t.dueDate = "2026-02-30";
  assert.throws(() => validateTickets([t]));
  t.dueDate = "";
  assert.throws(() => validateTickets([t, t]));
  t.knowledge = "yes";
  assert.throws(() => validateTickets([t]));
});
test("ナレッジ候補は完了分のみを標準抽出し、期間指定もできる", () => {
  const a = plain();
  a.completedAt = "2026-11-11T10:00:00.000Z";
  a.knowledge = true;
  const b = { ...plain(), id: "task-2", knowledge: true };
  const c = { ...plain(), id: "task-3", completedAt: "2026-11-12T10:00:00.000Z" };
  assert.equal(chooseExportTickets([a,b,c], {scope:"knowledge",from:"",to:""}).length, 1);
  assert.equal(chooseExportTickets([a,b,c], {scope:"done",from:"",to:""}).length, 2);
  assert.equal(chooseExportTickets([a,b,c], {scope:"all",from:"2026-11-12",to:""}).length, 0);
});
test("Markdownは問い合わせ・対応履歴・最終回答を分離して出力する", () => {
  const t = plain();
  t.note = "申請書の書き方について相談";
  t.history = [{ id:"history-1", createdAt:now, text:"担当部署に確認した" }];
  t.finalAnswer = "記入例を案内した。";
  const result = serializeTickets([t], outputOptions());
  assert.equal(result.count, 1);
  assert.match(result.content, /### 受付内容・メモ/);
  assert.match(result.content, /### 対応履歴/);
  assert.match(result.content, /### 最終回答・対応結果/);
  assert.match(result.content, /記入例を案内した。/);
});
test("CSVはExcelの数式と誤認する内容をエスケープする", () => {
  const t = plain();
  t.title = "=HYPERLINK(\"https://example.invalid\", \"リンク\")";
  const result = serializeTickets([t], outputOptions({format:"csv"}));
  assert.equal(result.count, 1);
  assert.match(result.content, /'=HYPERLINK/);
  assert.match(result.content, /""https:\/\/example.invalid""/);
});
test("JSON出力では除外した情報を含めず、元の記録は変更しない", () => {
  const t = plain();
  t.history = [{id:"h-1",createdAt:now,text:"確認した"}];
  t.finalAnswer = "回答";
  t.references = "マニュアル";
  const before = JSON.stringify(t);
  const result = serializeTickets([t], outputOptions({
    format:"json", includeHistory:false, includeAnswer:false, includeReferences:false
  }));
  const exportData = JSON.parse(result.content);
  assert.equal(exportData.format, "urachan-knowledge-export");
  assert.equal(exportData.items.length, 1);
  assert.equal("history" in exportData.items[0], false);
  assert.equal("finalAnswer" in exportData.items[0], false);
  assert.equal("references" in exportData.items[0], false);
  assert.equal(JSON.stringify(t), before);
});
test("拡張機能との連携・バックアップ・配布ZIPの登録を検査する", () => {
  const manifest = JSON.parse(readFileSync(path.join(base,"manifest.json"), "utf8"));
  const panel = readFileSync(path.join(base,"panel.js"), "utf8");
  const html = readFileSync(path.join(base,"panel.html"), "utf8");
  const release = readFileSync(path.join(base,".github/workflows/release-extension.yml"), "utf8");
  assert.equal(manifest.version,"0.6.0");
  assert.equal(manifest.host_permissions,undefined);
  assert.match(panel, /\{ id: "tasks", name: "メモ・タスク"/);
  assert.match(panel, /tasks: state\.tasks/);
  assert.match(panel, /UraTaskTools\.validateTickets/);
  assert.match(html, /task-tools\.js/);
  assert.match(release, /node --check task-tools\.js/);
  assert.match(release, /panel\.js image-tools\.js task-tools\.js/);
  assert.doesNotMatch(code, /\bfetch\s*\(/);
});
