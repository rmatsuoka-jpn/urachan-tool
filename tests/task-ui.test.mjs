// 軽量DOMでメモ・タスクの主要な操作を検証する。Chrome自体の実機試験は別途実施する。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "task-tools.js"), "utf8");

class FakeNode {
  constructor(tag = "") {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.className = "";
    this.value = "";
    this.checked = false;
    this._text = "";
    this.classList = {
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(" ");
      }
    };
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this._text = "";
    this.children = [];
    this.append(...children);
  }
  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((node) => node.textContent || "").join("");
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  fire(name) { for (const handler of this.listeners[name] || []) handler({ target: this }); }
  focus() { this.focused = true; }
}

function findAll(node, predicate) {
  const found = predicate(node) ? [node] : [];
  for (const child of node.children || []) found.push(...findAll(child, predicate));
  return found;
}
function byClass(rootNode, name) {
  return findAll(rootNode, (node) => node.className?.split(" ").includes(name));
}
function button(rootNode, label) {
  return findAll(rootNode, (node) => node.tag === "button" && node.textContent.includes(label))[0];
}
function sample() {
  const date = "2026-11-11T01:00:00.000Z";
  return { version: 1, nextNumber: 3, items: [
    { id: "a", number: 1, title: "問い合わせ", memo: "", dueDate: "",
      createdAt: date, updatedAt: date, completedAt: null, knowledgeCandidate: false,
      finalAnswer: "最終回答を表示", references: "", history: [
        { id: "h1", at: "2026-11-11T02:00:00.000Z", text: "もっと新しい履歴" }
      ] },
    { id: "b", number: 2, title: "対応メモ", memo: "", dueDate: "",
      createdAt: date, updatedAt: date, completedAt: null, knowledgeCandidate: false,
      finalAnswer: "", references: "", history: [
        { id: "h2", at: "2026-11-11T03:00:00.000Z", text: "最も新しい記録" },
        { id: "h3", at: "2026-11-11T02:00:00.000Z", text: "古い記録" }
      ] }
  ]};
}
function setup() {
  let decision = true;
  let seq = 0;
  const host = { tag: "main" };
  const main = new FakeNode("main");
  const document = {
    createElement: (name) => new FakeNode(name),
    createTextNode: (value) => { const n = new FakeNode("#text"); n.textContent = value; return n; },
    getElementById: (id) => findAll(main, (n) => n.id === id)[0] || null
  };
  const sandbox = {
    window: {}, document, Node: FakeNode,
    crypto: { randomUUID: () => "test-" + (++seq) },
    confirm: () => decision, URL, Blob, setTimeout, console
  };
  vm.runInNewContext(source, sandbox);
  const api = sandbox.window.UraTasks;
  const context = { state: { tasks: sample() }, persist: async () => {}, notify: () => {}, render: () => {
    main.replaceChildren();
    api.render(main, context);
  }};
  context.render();
  return { main, api, context, decide: (next) => { decision = next; } };
}

test("一覧は回答優先、回答がなければ最も新しい履歴を2行の領域に表示する", () => {
  const { main } = setup();
  assert.equal(byClass(main, "task-item").length, 2);
  const previews = byClass(main, "task-preview");
  assert.equal(previews.length, 2);
  assert.match(previews[0].textContent, /最終回答・結果/);
  assert.match(previews[0].textContent, /最終回答を表示/);
  assert.doesNotMatch(previews[0].textContent, /もっと新しい履歴/);
  assert.match(previews[1].textContent, /最新の対応履歴/);
  assert.match(previews[1].textContent, /最も新しい記録/);
  assert.equal(byClass(main, "task-complete-label").length, 2);
  const css = readFileSync(join(root, "panel.css"), "utf8");
  assert.match(css, /-webkit-line-clamp:2/);
});

test("一覧の☆を即時切り替え、詳細の★と完了を同じ意味の操作にする", () => {
  const { main, context } = setup();
  const stars = byClass(main, "task-star");
  assert.equal(stars.length, 2);
  assert.equal(stars[0].getAttribute("aria-pressed"), "false");
  stars[0].fire("click");
  assert.equal(context.state.tasks.items[0].knowledgeCandidate, true);
  assert.equal(stars[0].getAttribute("aria-pressed"), "true");

  const firstTitle = findAll(main, (node) => node.tag === "button" && node.className === "task-name"
    && node.textContent.includes("問い合わせ"))[0];
  firstTitle.fire("click");
  assert.equal(byClass(main, "task-detail-section").length, 3);
  assert.equal(byClass(main, "task-detail-status").length, 1);
  assert.match(byClass(main, "task-star")[0].textContent, /★ ナレッジ候補/);
  assert.equal(byClass(main, "task-complete-label").length, 1);
  assert.equal(button(main, "変更を保存") !== undefined, true);
  assert.equal(button(main, "回答・参考情報を保存"), undefined);
  assert.equal(button(main, "✓ 対応完了"), undefined);
});

test("詳細を離れるときの未保存確認はキャンセルでき、許可時には破棄する", () => {
  const { main, api, context, decide } = setup();
  button(main, "詳細").fire("click");
  const memo = findAll(main, (node) => node.tag === "textarea")[0];
  memo.value = "編集途中";
  assert.equal(api.hasUnsavedDetail(), true);
  decide(false);
  button(main, "一覧に戻る").fire("click");
  assert.equal(byClass(main, "task-detail-section").length, 3);
  assert.equal(api.confirmLeave(), false);
  decide(true);
  button(main, "一覧に戻る").fire("click");
  assert.equal(byClass(main, "task-item").length, 2);
  assert.equal(context.state.tasks.items[0].memo, "");
});

test("詳細の完了は未保存の入力を確認・保存し、履歴の入力途中は完了させない", () => {
  const { main, api, context, decide } = setup();
  button(main, "詳細").fire("click");
  const answer = findAll(main, (node) => node.tag === "textarea")[1];
  answer.value = "回答を修正";
  const complete = byClass(main, "task-complete")[0];
  complete.checked = true;
  decide(false);
  complete.fire("change");
  assert.equal(complete.checked, false);
  assert.equal(context.state.tasks.items[0].completedAt, null);
  decide(true);
  complete.checked = true;
  complete.fire("change");
  assert.equal(context.state.tasks.items[0].finalAnswer, "回答を修正");
  assert.ok(context.state.tasks.items[0].completedAt);

  // 完了解除して履歴入力中の動作を検証。
  byClass(main, "task-complete")[0].fire("change");
  button(main, "対応履歴を追加").fire("click");
  const history = findAll(main, (node) => node.id === "task-history-input")[0];
  history.value = "まだ保存していない履歴";
  assert.equal(api.hasUnsavedDetail(), true);
  byClass(main, "task-complete")[0].fire("change");
  assert.equal(context.state.tasks.items[0].completedAt, null);
  assert.equal(history.value, "まだ保存していない履歴");
});
