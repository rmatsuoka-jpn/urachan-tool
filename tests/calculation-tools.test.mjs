import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreSource = readFileSync(join(root, "calculation-core.js"), "utf8");
const uiSource = readFileSync(join(root, "calculation-tools.js"), "utf8");
const context = { window: {} };
vm.runInNewContext(coreSource + "\n" + uiSource, context);
const { compute, evaluate, stringify, decimal } = context.window.UraCalcCore;
const tools = context.window.UraCalculations.tools;
const by = (result, label) => result.results.find(item => item.label === label)?.value;

test("計算カテゴリは4つ、業務計算は9つ", () => {
  assert.equal(context.window.UraCalculations.categories.length, 4);
  assert.equal(Object.keys(tools).length, 9);
  assert.ok(tools["travel-estimate"]);
  assert.equal(tools["travel-settlement"], undefined);
});
test("テンキー用数式は演算順序・括弧・負数と十進小数を扱う", () => {
  assert.equal(stringify(evaluate("0.1+0.2")), "0.3");
  assert.equal(stringify(evaluate("100+3*5")), "115");
  assert.equal(stringify(evaluate("(100+3)*5")), "515");
  assert.equal(stringify(evaluate("-5+2")), "-3");
  assert.equal(stringify(evaluate("12,500×2")), "25000");
});
test("不正な数式・0除算・極大値を拒否", () => {
  for (const expression of ["1/0", "1++2", "1+alert(1)", "10+", "(", "1e30",
    "999999999999999999", "1".repeat(121)]) {
    assert.throws(() => evaluate(expression), expression);
  }
  assert.throws(() => decimal("0.1234567"), /小数6桁/);
});
test("割合30%、増減額と増減率、0比較、ポイント差", () => {
  assert.equal(by(compute("ratio", { whole: "1250", part: "375" }), "割合・達成率"), "30.0");
  const changed = compute("change", { before: "8000000", after: "9200000" });
  assert.equal(by(changed, "増減額"), "1200000");
  assert.equal(by(changed, "増減率"), "15.0");
  const zero = compute("change", { before: "0", after: "100" });
  assert.equal(by(zero, "増減率"), undefined);
  assert.match(zero.note, /比較元が0/);
  assert.equal(by(compute("change", { before: "60", after: "75" }, { percentPoints: true }),
    "パーセントポイント差"), "15.0");
});
test("消費税の税抜→税込、税込→税抜、8%と端数方式", () => {
  const add = compute("tax", { amount: "10000" }, { direction: "add", taxRate: "10" });
  assert.equal(by(add, "税込額"), "11000");
  assert.equal(by(add, "消費税相当額"), "1000");
  const remove = compute("tax", { amount: "11000" }, { direction: "remove", taxRate: "10" });
  assert.equal(by(remove, "税抜額"), "10000");
  assert.equal(by(remove, "税込額"), "11000");
  assert.equal(by(compute("tax", { amount: "101" }, { direction: "add", taxRate: "8", roundMode: "down" }),
    "消費税相当額"), "8");
  assert.equal(by(compute("tax", { amount: "101" }, { direction: "add", taxRate: "8", roundMode: "up" }),
    "消費税相当額"), "9");
});
test("補助金の率・上限・端数処理（端数処理後の上限も確認）", () => {
  assert.equal(by(compute("subsidy", { base: "55000" }, {
    rateType: "1/2", unit: "1000", roundMode: "down" }), "概算額"), "27000");
  assert.equal(by(compute("subsidy", { base: "100000", cap: "30000" }, {
    rateType: "1/2", unit: "1", roundMode: "down" }), "概算額"), "30000");
  assert.equal(by(compute("subsidy", { base: "9999", cap: "2501" }, {
    rateType: "1/2", unit: "1000", roundMode: "up" }), "概算額"), "2501");
});
test("千円未満切捨て、単価・数量の積算、負数の切上げ", () => {
  assert.equal(by(compute("round", { amount: "1234567" }, { unit: "1000", roundMode: "down" }),
    "処理後"), "1234000");
  assert.equal(by(compute("unit-price", { price: "2500", quantity: "35" }), "積算額"), "87500");
  assert.equal(by(compute("unit-price", { price: "0.1", quantity: "3" }), "積算額"), "0.3");
  assert.equal(by(compute("round", { amount: "-1.1" }, { unit: "1", roundMode: "up" }), "処理後"), "-1");
});
test("合計・平均では空行を数えず明示0を含める", () => {
  const result = compute("sum-average", { values: ["10", "", "0"] }, { digits: "2" });
  assert.equal(by(result, "合計"), "10");
  assert.equal(by(result, "平均"), "5.00");
  assert.equal(by(result, "件数"), "2");
});
test("交通費明細で回数と総額を計算", () => {
  const result = compute("fare-items", { rows: [
    { kind: "rail", amount: "12500", quantity: "2" },
    { kind: "bus", amount: "4000", quantity: "1" },
    { kind: "other", amount: "", quantity: "1" }
  ] });
  assert.equal(by(result, "交通費明細合計"), "29000");
});
test("出張旅費は概算のみ、手当日数と人数・回数を別指定", () => {
  const input = { days: "3", nights: "2", fare: "64000", hotelRate: "11000",
    perDiem: "3500", allowanceDays: "3" };
  const one = compute("travel-estimate", input);
  assert.equal(by(one, "全体の旅費概算"), "96500");
  const two = compute("travel-estimate", input, { people: "2", trips: "1" });
  assert.equal(by(two, "全体の旅費概算"), "193000");
  assert.throws(() => compute("travel-estimate",
    { ...input, allowanceDays: "" }), /手当対象日数/);
  assert.throws(() => compute("travel-estimate",
    { ...input, nights: "4" }), /宿泊数/);
});
test("パック料金は別計上の交通費・宿泊費を除外", () => {
  const value = compute("travel-estimate", {
    days: "3", nights: "2", fare: "64000", hotelRate: "11000",
    packageAmount: "70000", perDiem: "3500", allowanceDays: "3", extras: "1000"
  }, { usePackage: true, people: "1" });
  assert.equal(by(value, "全体の旅費概算"), "81500");
  assert.equal(by(value, "交通費"), "0");
  assert.equal(by(value, "宿泊費"), "0");
});
test("必須未入力・負数・不正な日数は受け付けない", () => {
  assert.throws(() => compute("ratio", { whole: "", part: "10" }));
  assert.throws(() => compute("tax", { amount: "-10" }));
  assert.throws(() => compute("fare-items", { rows: [{ amount: "-1", quantity: "1" }] }));
  assert.throws(() => compute("travel-estimate", { days: "0", nights: "0" }));
});
