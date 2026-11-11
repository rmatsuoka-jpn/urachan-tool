/* Offline decimal and administrative calculation engine (no eval or network). */
(function (root) {
  "use strict";
  const LIMIT = 100000000000000n;
  const ERROR_MISSING = "必要な数値を入力してください。";
  function fail(message) { throw new Error(message); }
  function gcd(a, b) {
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1n;
  }
  function rat(n, d = 1n) {
    n = BigInt(n); d = BigInt(d);
    if (!d) fail("0で割ることはできません。");
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d);
    n /= g; d /= g;
    if (n.toString().length > 40 || d.toString().length > 40) fail("計算する数値が大きすぎます。");
    return { n, d };
  }
  const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
  const neg = a => rat(-a.n, a.d);
  const sub = (a, b) => add(a, neg(b));
  const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
  const div = (a, b) => rat(a.n * b.d, a.d * b.n);
  const cmp = (a, b) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
  function decimal(value, options = {}) {
    const raw = String(value == null ? "" : value).trim().replace(/,/g, "");
    if (!raw) {
      if (options.optional) return null;
      fail(ERROR_MISSING);
    }
    if (!/^[+-]?(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/.test(raw)) {
      fail("数値は整数または小数6桁以内で入力してください。");
    }
    const minus = raw.startsWith("-");
    const unsigned = raw.replace(/^[+-]/, "");
    const [whole, fraction = ""] = unsigned.split(".");
    if (whole.length > 15) fail("入力できる数値は100兆未満です。");
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole || "0") * denominator + BigInt(fraction || "0");
    if (numerator >= LIMIT * denominator) fail("入力できる数値は100兆未満です。");
    const result = rat(minus ? -numerator : numerator, denominator);
    if (options.nonnegative && result.n < 0n) fail("0以上の数値を入力してください。");
    return result;
  }
  function integer(value, name, min = 0, max = 10000, optional = false) {
    if (String(value == null ? "" : value).trim() === "") {
      if (optional) return null;
      fail(name + "を入力してください。");
    }
    if (!/^\d+$/.test(String(value))) fail(name + "は整数で入力してください。");
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) fail(name + "は" + min + "～" + max + "で入力してください。");
    return n;
  }
  function nonnegative(value, optional = false) { return decimal(value, { nonnegative: true, optional }); }
  function floorDiv(n, d) {
    let q = n / d;
    if (n < 0n && n % d) q--;
    return q;
  }
  function ceilDiv(n, d) {
    let q = n / d;
    if (n > 0n && n % d) q++;
    return q;
  }
  function halfAway(n, d) {
    const abs = n < 0n ? -n : n;
    const r = (abs + abs % d) / d;
    return n < 0n ? -r : r;
  }
  function quantize(value, step, mode = "down") {
    const ratio = div(value, step);
    let units;
    if (mode === "down") units = floorDiv(ratio.n, ratio.d);
    else if (mode === "up") units = ceilDiv(ratio.n, ratio.d);
    else if (mode === "nearest") units = halfAway(ratio.n, ratio.d);
    else fail("端数処理の方法が正しくありません。");
    return mul(rat(units), step);
  }
  function stringify(value, places = 6, fixed = false) {
    places = Math.max(0, Math.min(6, Number(places) || 0));
    const scale = 10n ** BigInt(places);
    const rounded = halfAway(value.n * scale, value.d);
    const sign = rounded < 0n ? "-" : "";
    const abs = rounded < 0n ? -rounded : rounded;
    const full = abs.toString().padStart(places + 1, "0");
    if (!places) return sign + full;
    const at = full.length - places;
    let str = sign + full.slice(0, at) + "." + full.slice(at);
    if (!fixed) str = str.replace(/0+$/, "").replace(/\.$/, "");
    return str;
  }
  function evaluate(expression) {
    let s = String(expression == null ? "" : expression)
      .replace(/[,，\s]/g, "").replace(/[×＊]/g, "*").replace(/[÷／]/g, "/")
      .replace(/[−－]/g, "-").replace(/[＋]/g, "+").replace(/[（]/g, "(").replace(/[）]/g, ")");
    if (!s || s.length > 120 || !/^[0-9.+*/()\-]+$/.test(s)) fail("数式は数字と四則演算で120文字以内にしてください。");
    let i = 0; let depth = 0;
    function number() {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(s.slice(i));
      if (!match) fail("数式の入力を確認してください。");
      i += match[0].length;
      return decimal(match[0]);
    }
    function atom() {
      if (s[i] === "-") { i++; return neg(atom()); }
      if (s[i] === "(") {
        if (++depth > 8) fail("括弧が多すぎます。");
        i++;
        const result = sum();
        if (s[i++] !== ")") fail("括弧が閉じられていません。");
        depth--;
        return result;
      }
      return number();
    }
    function product() {
      let value = atom();
      while (s[i] === "*" || s[i] === "/") {
        const op = s[i++]; const right = atom();
        value = op === "*" ? mul(value, right) : div(value, right);
      }
      return value;
    }
    function sum() {
      let value = product();
      while (s[i] === "+" || s[i] === "-") {
        const op = s[i++]; const right = product();
        value = op === "+" ? add(value, right) : sub(value, right);
      }
      return value;
    }
    const value = sum();
    if (i !== s.length) fail("数式の入力を確認してください。");
    if (value.n >= LIMIT * value.d || value.n <= -LIMIT * value.d) fail("計算結果が大きすぎます。");
    return value;
  }
  function requirePositive(a, label) { if (a.n <= 0n) fail(label + "は0より大きい数値にしてください。"); return a; }
  function rate(value) {
    const result = nonnegative(value);
    if (cmp(result, rat(100)) > 0) fail("率は0～100%で入力してください。");
    return div(result, rat(100));
  }
  function roundOptions(o = {}) {
    const unit = String(o.unit || "1");
    if (!["1", "10", "100", "1000", "10000"].includes(unit)) fail("端数処理の単位が正しくありません。");
    return { unit: decimal(unit), mode: o.roundMode || "down", unitText: unit };
  }
  function result(label, value, unit = "", places = 6, fixed = false) {
    const plain = stringify(value, places, fixed);
    return { label, value: plain, unit, copy: plain + (unit === "%" ? "%" : "") };
  }
  function compute(id, input = {}, options = {}) {
    const o = options;
    const items = [];
    let formula = ""; let note = "";
    switch (id) {
      case "ratio": {
        const whole = requirePositive(nonnegative(input.whole), "全体・目標");
        const part = nonnegative(input.part);
        const digits = integer(o.digits == null ? "1" : o.digits, "小数桁数", 0, 4);
        items.push(result("割合・達成率", mul(div(part, whole), rat(100)), "%", digits, true));
        items.push(result("残数・差分（全体－対象）", sub(whole, part)));
        formula = "対象 ÷ 全体 × 100";
        break;
      }
      case "change": {
        const before = decimal(input.before); const after = decimal(input.after);
        const diff = sub(after, before);
        items.push(result("増減額", diff));
        const digits = integer(o.digits == null ? "1" : o.digits, "小数桁数", 0, 4);
        if (before.n > 0n) items.push(result("増減率", mul(div(diff, before), rat(100)), "%", digits, true));
        else note = before.n === 0n ? "比較元が0のため増減率は算出できません。" : "比較元が負数のため増減率を表示しません。";
        if (o.percentPoints === true) {
          items.push(result("パーセントポイント差", diff, "ポイント", digits, true));
          note += (note ? " " : "") + "比較元・先にパーセント値を入力した場合の差です。";
        }
        formula = "増減額＝比較先－比較元、増減率＝増減額÷比較元×100";
        break;
      }
      case "tax": {
        const amount = nonnegative(input.amount);
        const taxRate = rate(o.taxRate === "custom" ? input.customTaxRate : (o.taxRate || "10"));
        const method = o.roundMode || "down";
        let net, gross, tax;
        if ((o.direction || "add") === "add") {
          net = amount;
          tax = quantize(mul(net, taxRate), rat(1), method);
          gross = add(net, tax);
        } else if (o.direction === "remove") {
          gross = amount;
          net = quantize(div(gross, add(rat(1), taxRate)), rat(1), method);
          tax = sub(gross, net);
          note = "税込額からの簡易逆算です。請求書全体の税額算定ではありません。";
        } else fail("税込／税抜の選択が正しくありません。");
        items.push(result("税抜額", net, "円", 0));
        items.push(result("消費税相当額", tax, "円", 0));
        items.push(result("税込額", gross, "円", 0));
        formula = "税率 " + stringify(mul(taxRate, rat(100)), 4) + "%、1円未満 " +
          ({ down: "切捨て", up: "切上げ", nearest: "四捨五入" }[method] || "");
        break;
      }
      case "subsidy": {
        const base = nonnegative(input.base);
        const rt = o.rateType || "1/2";
        const fractions = { "1/2": rat(1n, 2n), "1/3": rat(1n, 3n), "2/3": rat(2n, 3n) };
        const subsidyRate = rt === "custom" ? rate(input.customRate) : fractions[rt];
        if (!subsidyRate) fail("補助率の選択が正しくありません。");
        const raw = mul(base, subsidyRate);
        const cap = nonnegative(input.cap, true);
        const r = roundOptions(o);
        let capped = cap && cmp(raw, cap) > 0 ? cap : raw;
        let estimated = quantize(capped, r.unit, r.mode);
        if (cap && cmp(estimated, cap) > 0) { estimated = cap; note = "端数処理後に上限額を再適用しました。"; }
        items.push(result("補助率による算出額", raw, "円"));
        items.push(result("概算額", estimated, "円"));
        formula = "対象額 × 補助率 → 上限適用 → " + r.unitText + "円単位の端数処理";
        note += (note ? " " : "") + "交付要綱によって計算順序が異なります。";
        break;
      }
      case "round": {
        const amount = decimal(input.amount);
        const r = roundOptions(o);
        const rounded = quantize(amount, r.unit, r.mode);
        items.push(result("処理後", rounded));
        items.push(result("差額（処理後－元）", sub(rounded, amount)));
        formula = r.unitText + "単位・" + ({ down: "切捨て", up: "切上げ", nearest: "四捨五入" }[r.mode] || "");
        break;
      }
      case "unit-price": {
        const price = nonnegative(input.price); const quantity = nonnegative(input.quantity);
        let amount = mul(price, quantity);
        if (o.useRound) {
          const r = roundOptions(o);
          amount = quantize(amount, r.unit, r.mode);
        }
        items.push(result("積算額", amount));
        formula = "単価 × 数量" + (o.useRound ? " → 指定単位で端数処理" : "");
        break;
      }
      case "sum-average": {
        const values = Array.isArray(input.values) ? input.values : [];
        if (values.length > 100) fail("集計できる数値は100件までです。");
        let total = rat(0); let count = 0;
        for (const value of values) {
          if (String(value == null ? "" : value).trim() === "") continue;
          total = add(total, decimal(value)); count++;
        }
        if (!count) fail(ERROR_MISSING);
        const digits = integer(o.digits == null ? "2" : o.digits, "小数桁数", 0, 6);
        items.push(result("合計", total));
        items.push(result("平均", div(total, rat(count)), "", digits, true));
        items.push(result("件数", rat(count), "件", 0));
        formula = "入力された数値の合計 ÷ 件数（空欄は対象外）";
        break;
      }
      case "fare-items": {
        const rows = Array.isArray(input.rows) ? input.rows : [];
        if (rows.length > 50) fail("交通費明細は50行までです。");
        let total = rat(0); let count = 0;
        for (const row of rows) {
          if (!row || String(row.amount == null ? "" : row.amount).trim() === "") continue;
          const fare = nonnegative(row.amount);
          const quantity = integer(row.quantity == null ? "1" : row.quantity, "利用回数", 1, 100);
          total = add(total, mul(fare, rat(quantity))); count++;
        }
        if (!count) fail(ERROR_MISSING);
        items.push(result("交通費明細合計", total, "円"));
        items.push(result("明細件数", rat(count), "件", 0));
        formula = "各運賃 × 利用回数の合計（往復合計を入力した場合は回数1）";
        break;
      }
      case "travel-estimate": {
        const days = integer(input.days, "旅行日数", 1, 365);
        const nights = integer(input.nights, "宿泊数", 0, 365);
        if (nights > days) fail("宿泊数は旅行日数以下にしてください。");
        const people = integer(o.people == null ? "1" : o.people, "人数", 1, 100);
        const trips = integer(o.trips == null ? "1" : o.trips, "出張回数", 1, 100);
        const extras = nonnegative(input.extras, true) || rat(0);
        const perDiem = nonnegative(input.perDiem, true);
        const allowanceDays = integer(input.allowanceDays, "手当対象日数", 0, 365, true);
        if (perDiem && perDiem.n > 0n && allowanceDays == null) {
          fail("手当単価を入力した場合は手当対象日数も指定してください。");
        }
        const allowance = mul(perDiem || rat(0), rat(allowanceDays || 0));
        let fare = rat(0), hotel = rat(0), pack = rat(0);
        if (o.usePackage) {
          pack = nonnegative(input.packageAmount);
          note = "パック料金に含まれる交通費・宿泊費は重複計上しません。";
        } else {
          fare = o.fareMode === "items" ? (input.itemFare ? nonnegative(input.itemFare) : rat(0)) : (nonnegative(input.fare, true) || rat(0));
          const hotelMode = o.hotelMode || "flat";
          const hotelRate = nonnegative(input.hotelRate, true) || rat(0);
          if (hotelMode === "flat" || hotelMode === "actual") hotel = mul(hotelRate, rat(nights));
          else if (hotelMode === "capped") {
            const cap = nonnegative(input.hotelCap);
            hotel = mul(cmp(hotelRate, cap) > 0 ? cap : hotelRate, rat(nights));
          } else fail("宿泊費の方式が正しくありません。");
        }
        const one = add(add(add(add(fare, hotel), allowance), pack), extras);
        const grand = mul(one, rat(people * trips));
        items.push(result("全体の旅費概算", grand, "円"));
        items.push(result("1人・1回あたり", one, "円"));
        items.push(result("交通費", fare, "円"));
        items.push(result("宿泊費", hotel, "円"));
        items.push(result("日当・手当", allowance, "円"));
        if (o.usePackage) items.push(result("パック料金", pack, "円"));
        if (extras.n) items.push(result("その他交通費", extras, "円"));
        formula = "1人・1回あたりの費目合計 × " + people + "人 × " + trips + "回";
        note += (note ? " " : "") + "概算用です。正式な旅費支給額は算定しません。";
        if (!perDiem) note += " 手当は未計上です。";
        break;
      }
      default: fail("計算機能が見つかりません。");
    }
    return { results: items, formula, note };
  }
  root.UraCalcCore = { compute, decimal, evaluate, stringify, quantize, rat, add, sub, mul, div };
})(typeof window !== "undefined" ? window : globalThis);
