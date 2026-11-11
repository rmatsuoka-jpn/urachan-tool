import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = join(dirname(fileURLToPath(import.meta.url)), "..");
class FakeNode {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.className = ""; this.value = "";
    this.listeners = {}; this.attributes = {}; this._text = "";
    this.classList = {
      add: name => { if (!this.className.split(" ").includes(name)) this.className += " " + name; },
      remove: name => { this.className = this.className.split(" ").filter(c => c !== name).join(" "); }
    };
  }
  append(...children) {
    for (const child of children) {
      if (child instanceof FakeNode) this.children.push(child);
      else this.children.push(new FakeText(child == null ? "" : String(child)));
    }
  }
  replaceChildren(...children) { this.children = []; this._text = ""; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.children = []; }
}
class FakeText extends FakeNode { constructor(value) { super("#text"); this._text = String(value); } }
function descendants(node, className) {
  return [node, ...node.children.flatMap(child => descendants(child, className))]
    .filter(child => child.className?.split(" ").includes(className));
}
function setup() {
  const sandbox = { window: {}, structuredClone, Node: FakeNode,
    document: { createElement: tag => new FakeNode(tag), createTextNode: value => new FakeText(value) } };
  vm.runInNewContext(readFileSync(join(base, "calculation-core.js"), "utf8"), sandbox);
  vm.runInNewContext(readFileSync(join(base, "calculation-tools.js"), "utf8"), sandbox);
  const main = new FakeNode("main");
  const state = { calculationRecent: [] };
  let saveCount = 0;
  sandbox.window.UraCalculations.render(main, {
    state, persist: () => { saveCount++; }, notify: () => {}, copyText: async () => {}
  });
  return { main, state, saves: () => saveCount };
}
test("カテゴリ画面から計算画面へ遷移し、最近使用した機能IDだけを保存", () => {
  const { main, state, saves } = setup();
  assert.equal(descendants(main, "calc-category").length, 4);
  descendants(main, "calc-category")[0].dispatch("click");
  assert.equal(descendants(main, "calc-tool-link").length, 2);
  descendants(main, "calc-tool-link")[0].dispatch("click");
  assert.equal(descendants(main, "calc-input").length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(state.calculationRecent)), ["ratio"]);
  assert.equal(saves(), 1);
  assert.equal("whole" in state, false);
});
test("テンキーの四則演算で入力欄へ確定し、計算結果が更新される", () => {
  const { main } = setup();
  descendants(main, "calc-category")[2].dispatch("click"); // 集計・単価
  descendants(main, "calc-tool-link")[0].dispatch("click"); // 単価×数量
  descendants(main, "calc-pad-open")[0].dispatch("click");
  assert.equal(descendants(main, "calc-keypad").length, 1);
  const buttons = descendants(main, "calc-pad-key");
  for (const key of ["1", "2", "×", "2", "="]) {
    const found = buttons.find(b => b.textContent === key);
    assert.ok(found, "missing keypad button " + key);
    found.dispatch("click");
  }
  assert.equal(descendants(main, "calc-keypad").length, 0);
  const inputs = descendants(main, "calc-input");
  assert.equal(inputs[0].value, "24");
  inputs[1].value = "3"; inputs[1].dispatch("input");
  assert.match(descendants(main, "calc-results")[0].textContent, /72/);
});
