/* Self-contained offline calculation forms and clickable keypad. */
(function (root) {
  "use strict";
  const core = root.UraCalcCore;
  const CATEGORIES = [
    { id: "compare", label: "割合・比較", icon: "％", tools: ["ratio", "change"] },
    { id: "money", label: "金額・税", icon: "¥", tools: ["tax", "subsidy", "round"] },
    { id: "aggregate", label: "集計・単価", icon: "Σ", tools: ["unit-price", "sum-average"] },
    { id: "travel", label: "旅費・交通費", icon: "✈", tools: ["travel-estimate", "fare-items"] }
  ];
  const TOOLS = {
    ratio: ["割合・達成率", "構成比・執行率・回答率"],
    change: ["増減・前年比", "前年度からの増減額と増減率"],
    tax: ["消費税", "税込・税抜の簡易換算"],
    subsidy: ["補助金・率計算", "補助率・上限額・端数処理"],
    round: ["端数処理", "切捨て・切上げ・四捨五入"],
    "unit-price": ["単価×数量", "見積金額などの積算"],
    "sum-average": ["合計・平均", "複数の数値を集計"],
    "travel-estimate": ["出張旅費の概算", "交通費・宿泊費・手当の見積り"],
    "fare-items": ["交通費明細", "交通手段ごとの金額を合計"]
  };
  const ROUNDS = [["down", "切捨て"], ["nearest", "四捨五入"], ["up", "切上げ"]];
  const UNITS = [["1", "1円・1単位"], ["10", "10円・10単位"], ["100", "100円・100単位"],
    ["1000", "千円・千単位"], ["10000", "万円・万単位"]];
  const MODE = {
    ratio: { digits: "1" }, change: { digits: "1", percentPoints: false },
    tax: { direction: "add", taxRate: "10", roundMode: "down" },
    subsidy: { rateType: "1/2", unit: "1", roundMode: "down" },
    round: { unit: "1000", roundMode: "down" },
    "unit-price": { useRound: false, unit: "1", roundMode: "down" },
    "sum-average": { digits: "2" },
    "travel-estimate": { people: "1", trips: "1", fareMode: "direct", hotelMode: "flat", usePackage: false },
    "fare-items": {}
  };
  const page = { screen: "categories", category: null, tool: null, drafts: {},
    openDetails: {}, keypad: null, returnToTravel: false, ctx: null, main: null };
  function node(tag, cls, children) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const child of Array.isArray(children) ? children : children == null ? [] : [children]) {
      if (child != null) e.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return e;
  }
  function txt(tag, value, cls) { return node(tag, cls, value); }
  function button(label, handler, cls = "calc-button") {
    const e = node("button", cls, label);
    e.type = "button"; e.addEventListener("click", handler);
    return e;
  }
  function draft(id) {
    if (!page.drafts[id]) {
      const inputs = {};
      if (id === "sum-average") inputs.values = ["", "", ""];
      if (id === "fare-items") inputs.rows = [{ kind: "rail", route: "", amount: "", quantity: "1" }];
      page.drafts[id] = { inputs, options: structuredClone(MODE[id]) };
    }
    return page.drafts[id];
  }
  function categoryFor(tool) { return CATEGORIES.find(c => c.tools.includes(tool)); }
  function go(screen, category, tool) {
    page.screen = screen; page.category = category || null; page.tool = tool || null; page.keypad = null;
    repaint();
  }
  function openTool(id, fromTravel = false) {
    if (!TOOLS[id]) return;
    page.returnToTravel = id === "fare-items" && fromTravel;
    page.tool = id;
    page.category = categoryFor(id).id;
    page.screen = "tool";
    page.keypad = null;
    const recent = Array.isArray(page.ctx.state.calculationRecent) ? page.ctx.state.calculationRecent : [];
    page.ctx.state.calculationRecent = [id, ...recent.filter(value => value !== id)].slice(0, 3);
    page.ctx.persist();
    repaint();
  }
  function label(textValue, target) {
    const e = txt("label", textValue, "calc-label");
    if (target) e.htmlFor = target;
    return e;
  }
  function displayNumber(raw) {
    return String(raw).replace(/^(-?\d+)(?=\.|$)/, match => match.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  }
  function field(id, caption, settings = {}) {
    const d = draft(page.tool);
    const wrap = node("div", "calc-field");
    const control = node("div", "calc-input-row");
    const element = node("input", "calc-input");
    const key = "calc-" + page.tool + "-" + id;
    element.id = key;
    element.type = "text";
    element.inputMode = "decimal";
    element.autocomplete = "off";
    element.spellcheck = false;
    element.placeholder = settings.placeholder || "数値を入力";
    element.value = d.inputs[id] || "";
    element.setAttribute("aria-label", caption);
    element.addEventListener("input", () => { d.inputs[id] = element.value; updateResults(); });
    const pad = button("▦", () => openPad(id, caption), "calc-pad-open");
    pad.title = caption + "を電卓で入力";
    pad.setAttribute("aria-label", caption + "を電卓で入力");
    control.append(element, pad);
    wrap.append(label(caption, key), control);
    if (settings.help) wrap.append(txt("small", settings.help, "calc-hint"));
    return wrap;
  }
  function selectField(id, caption, options, initial, repaintOnChange = false) {
    const d = draft(page.tool);
    if (d.options[id] == null) d.options[id] = initial;
    const box = node("div", "calc-field");
    const sel = node("select", "calc-select");
    sel.setAttribute("aria-label", caption);
    for (const [value, text] of options) {
      const option = node("option", null, text);
      option.value = value; option.selected = String(d.options[id]) === String(value);
      sel.append(option);
    }
    sel.addEventListener("change", () => {
      d.options[id] = sel.value;
      if (repaintOnChange) repaint(); else updateResults();
    });
    box.append(label(caption), sel);
    return box;
  }
  function checkboxField(id, caption, repaintOnChange = false) {
    const d = draft(page.tool);
    const wrap = node("label", "calc-check");
    const check = node("input");
    check.type = "checkbox"; check.checked = Boolean(d.options[id]);
    check.addEventListener("change", () => {
      d.options[id] = check.checked;
      if (repaintOnChange) repaint(); else updateResults();
    });
    wrap.append(check, txt("span", caption));
    return wrap;
  }
  function group(...children) { return node("div", "calc-grid", children); }
  function moreOptions(...children) {
    const detail = node("details", "calc-details");
    detail.open = Boolean(page.openDetails[page.tool]);
    const summary = txt("summary", "詳細設定");
    detail.addEventListener("toggle", () => { page.openDetails[page.tool] = detail.open; });
    detail.append(summary, node("div", "calc-detail-body", children));
    return detail;
  }
  function roundControls() {
    return group(selectField("roundMode", "端数処理", ROUNDS, "down"),
      selectField("unit", "処理単位", UNITS, "1"));
  }
  function addFields(container, id) {
    const d = draft(id);
    switch (id) {
      case "ratio":
        container.append(field("whole", "全体・目標値"), field("part", "対象・実績値"),
          moreOptions(selectField("digits", "割合の小数桁数", [["0","0桁"],["1","1桁"],["2","2桁"],["3","3桁"],["4","4桁"]], "1")));
        break;
      case "change":
        container.append(field("before", "比較元（前年度など）"), field("after", "比較先（今年度など）"),
          moreOptions(selectField("digits", "率の小数桁数", [["0","0桁"],["1","1桁"],["2","2桁"],["3","3桁"],["4","4桁"]], "1"),
            checkboxField("percentPoints", "2つの数値が％値の場合、ポイント差も表示")));
        break;
      case "tax":
        container.append(selectField("direction", "計算方向", [["add","税抜 → 税込"],["remove","税込 → 税抜"]], "add", true),
          selectField("taxRate", "税率", [["10","10%"],["8","8%"],["custom","任意の税率"]], "10", true),
          field("amount", d.options.direction === "remove" ? "税込金額（円）" : "税抜金額（円）"));
        container.append(moreOptions(...(d.options.taxRate === "custom" ? [field("customTaxRate", "任意税率（%）")] : []),
          selectField("roundMode", "1円未満の端数処理", ROUNDS, "down"),
          txt("p", "適格請求書の税額計算は、税率ごとに請求書単位で行う必要があります。", "calc-hint")));
        break;
      case "subsidy":
        container.append(field("base", "算定対象額（円）"),
          selectField("rateType", "補助率", [["1/2","1/2"],["1/3","1/3"],["2/3","2/3"],["custom","任意の補助率"]], "1/2", true));
        if (d.options.rateType === "custom") container.append(field("customRate", "任意の補助率（%）"));
        container.append(moreOptions(field("cap", "上限額（任意・円）"), roundControls(),
          txt("p", "対象額×補助率 → 上限適用 → 端数処理。交付要綱をご確認ください。", "calc-hint")));
        break;
      case "round":
        container.append(field("amount", "処理する数値"), roundControls());
        break;
      case "unit-price":
        container.append(field("price", "単価"), field("quantity", "数量"),
          moreOptions(checkboxField("useRound", "積算結果を端数処理する", true),
            ...(d.options.useRound ? [roundControls()] : [])));
        break;
      case "sum-average":
        container.append(renderValueRows());
        container.append(moreOptions(selectField("digits", "平均の小数桁数",
          [["0","0桁"],["1","1桁"],["2","2桁"],["3","3桁"],["4","4桁"],["5","5桁"],["6","6桁"]], "2")));
        break;
      case "travel-estimate":
        container.append(group(field("days", "旅行日数（日）"), field("nights", "宿泊数（泊）")));
        if (d.options.usePackage) {
          container.append(field("packageAmount", "航空＋宿泊などのパック料金（円）"));
          container.append(txt("p", "パックに含む交通費と宿泊費は別計上しません。", "calc-hint"));
        } else {
          container.append(selectField("fareMode", "交通費の入力方法", [["direct","金額を直接入力"],["items","交通費明細から集計"]], "direct", true));
          if (d.options.fareMode === "direct") container.append(field("fare", "交通費（1人・往復合計、円）"));
          else {
            const box = node("div", "calc-linked-fares");
            box.append(txt("span", "交通費明細の合計：" + linkedFareText()));
            box.append(button("明細を入力", () => openTool("fare-items", true), "calc-button"));
            container.append(box);
          }
          container.append(field("hotelRate", d.options.hotelMode === "flat" ? "宿泊料（1泊あたり、円）" : "宿泊実費（1泊あたり、円）"));
        }
        container.append(group(field("perDiem", "日当・手当単価（円）"), field("allowanceDays", "手当対象日数（日）")));
        container.append(moreOptions(
          group(field("extras", "その他の交通費（1人分・円）"), field("packageAmount", "パック料金（円・利用時のみ）")),
          group(selectField("people", "同条件の人数", [["1","1人"],["2","2人"],["3","3人"],["4","4人"],["5","5人"],["10","10人"]], "1"),
            selectField("trips", "出張回数", [["1","1回"],["2","2回"],["3","3回"],["4","4回"],["5","5回"],["10","10回"]], "1")),
          checkboxField("usePackage", "パック料金で交通費と宿泊費をまとめて計上", true),
          ...(!d.options.usePackage ? [
            selectField("hotelMode", "宿泊料の方式", [["flat","定額"],["actual","実費"],["capped","上限付き実費"]], "flat", true),
            ...(d.options.hotelMode === "capped" ? [field("hotelCap", "宿泊費の上限（1泊・円）")] : [])
          ] : []),
          txt("p", "同条件の職員だけ人数で一括計算。旅行日数と手当対象日数は別指定です。", "calc-hint")));
        break;
      case "fare-items":
        container.append(renderFareRows());
        break;
    }
  }
  function renderValueRows() {
    const d = draft("sum-average");
    const block = node("div", "calc-lines");
    d.inputs.values.forEach((value, index) => {
      const row = node("div", "calc-line");
      const input = node("input", "calc-input");
      input.type = "text"; input.inputMode = "decimal"; input.value = value; input.placeholder = (index + 1) + "件目";
      input.setAttribute("aria-label", (index + 1) + "件目の数値");
      input.addEventListener("input", () => { d.inputs.values[index] = input.value; updateResults(); });
      row.append(input, button("▦", () => openPad("values:" + index, (index + 1) + "件目"), "calc-pad-open"));
      row.append(button("×", () => { if (d.inputs.values.length > 1) d.inputs.values.splice(index, 1); repaint(); }, "calc-remove"));
      block.append(row);
    });
    block.append(button("＋ 数値を追加", () => {
      if (d.inputs.values.length >= 100) return page.ctx.notify("数値は100件までです。");
      d.inputs.values.push(""); repaint();
    }, "calc-button calc-add"));
    return block;
  }
  function renderFareRows() {
    const d = draft("fare-items"); const block = node("div", "calc-lines");
    const methods = [["air","航空"],["rail","鉄道"],["bus","バス"],["ship","船舶"],["taxi","タクシー"],["other","その他"]];
    d.inputs.rows.forEach((item, index) => {
      const card = node("div", "calc-fare-row");
      const head = node("div", "calc-fare-head");
      head.append(txt("strong", "明細 " + (index + 1)));
      head.append(button("削除", () => { d.inputs.rows.splice(index, 1); repaint(); }, "calc-remove"));
      card.append(head);
      const selects = node("select", "calc-select"); selects.setAttribute("aria-label", "交通手段");
      for (const [value, caption] of methods) {
        const opt = node("option", null, caption); opt.value = value; opt.selected = item.kind === value;
        selects.append(opt);
      }
      selects.addEventListener("change", () => { item.kind = selects.value; });
      card.append(selects);
      const route = node("input", "calc-input");
      route.type = "text"; route.value = item.route || ""; route.maxLength = 100; route.placeholder = "区間メモ（任意）";
      route.setAttribute("aria-label", "区間メモ");
      route.addEventListener("input", () => { item.route = route.value; });
      card.append(route);
      const cost = node("div", "calc-input-row");
      const amount = node("input", "calc-input");
      amount.type = "text"; amount.inputMode = "decimal"; amount.value = item.amount || "";
      amount.placeholder = "運賃（円）"; amount.setAttribute("aria-label", "運賃（円）");
      amount.addEventListener("input", () => { item.amount = amount.value; updateResults(); });
      cost.append(amount, button("▦", () => openPad("rows:" + index, "明細" + (index + 1) + "の運賃"), "calc-pad-open"));
      const qbox = node("div", "calc-field");
      const q = node("input", "calc-input"); q.type = "text"; q.inputMode = "numeric";
      q.value = item.quantity == null ? "1" : item.quantity;
      q.setAttribute("aria-label", "利用回数");
      q.addEventListener("input", () => { item.quantity = q.value; updateResults(); });
      qbox.append(label("回数（往復合計なら1）"), q);
      card.append(cost, qbox);
      block.append(card);
    });
    block.append(button("＋ 交通費を追加", () => {
      if (d.inputs.rows.length >= 50) return page.ctx.notify("交通費明細は50行までです。");
      d.inputs.rows.push({ kind: "rail", route: "", amount: "", quantity: "1" }); repaint();
    }, "calc-button calc-add"));
    if (page.returnToTravel) block.append(button("← 旅費概算に反映", () => {
      draft("travel-estimate").options.fareMode = "items"; go("tool", "travel", "travel-estimate");
    }, "calc-button calc-return"));
    return block;
  }
  function linkedFareText() {
    try {
      const d = draft("fare-items");
      const r = core.compute("fare-items", d.inputs, d.options);
      return displayNumber(r.results[0].value) + "円";
    } catch { return "未入力"; }
  }
  function collect() {
    const d = draft(page.tool);
    const input = { ...d.inputs };
    if (page.tool === "travel-estimate" && d.options.fareMode === "items" && !d.options.usePackage) {
      const fares = core.compute("fare-items", draft("fare-items").inputs, draft("fare-items").options);
      input.itemFare = fares.results[0].value;
    }
    return core.compute(page.tool, input, d.options);
  }
  let resultSlot = null;
  function updateResults() {
    if (!resultSlot || page.screen !== "tool") return;
    resultSlot.replaceChildren();
    let evaluated;
    try { evaluated = collect(); }
    catch (err) {
      resultSlot.append(txt("p", err.message || "計算できません。", /入力してください|必要な数値/.test(err.message) ? "calc-hint" : "calc-error"));
      return;
    }
    for (const item of evaluated.results) {
      const row = node("div", "calc-result-row");
      const content = node("div", "calc-result-info");
      content.append(txt("small", item.label), txt("strong", displayNumber(item.value) + (item.unit === "%" ? "%" : item.unit ? " " + item.unit : "")));
      const copy = button("コピー", () => { void page.ctx.copyText(item.copy); }, "calc-copy");
      copy.setAttribute("aria-label", item.label + "をコピー");
      row.append(content, copy); resultSlot.append(row);
    }
    if (evaluated.formula) resultSlot.append(txt("p", evaluated.formula, "calc-hint"));
    if (evaluated.note) resultSlot.append(txt("p", evaluated.note, "calc-hint calc-caution"));
  }
  function getTarget(target) {
    const d = draft(page.tool);
    const [kind, index] = target.split(":");
    if (kind === "values") return { value: d.inputs.values[Number(index)] || "", assign: v => { d.inputs.values[Number(index)] = v; } };
    if (kind === "rows") return { value: d.inputs.rows[Number(index)].amount || "", assign: v => { d.inputs.rows[Number(index)].amount = v; } };
    return { value: d.inputs[target] || "", assign: v => { d.inputs[target] = v; } };
  }
  function openPad(target, caption) {
    const current = getTarget(target);
    const changed = page.keypad && page.keypad.expression !== page.keypad.original;
    page.keypad = { target, caption, expression: current.value.replace(/,/g,""), original: current.value.replace(/,/g, ""),
      notice: changed ? "前の未確定の数式は破棄しました。" : "" };
    repaint();
  }
  function padPanel() {
    const pad = page.keypad;
    const holder = node("section", "calc-keypad");
    const titleRow = node("div", "calc-pad-title");
    titleRow.append(txt("strong", pad.caption + "に入力中"),
      button("閉じる", () => { page.keypad = null; repaint(); }, "calc-pad-close"));
    holder.append(titleRow);
    const display = txt("div", pad.expression || "0", "calc-pad-display");
    display.setAttribute("aria-live", "polite");
    holder.append(display);
    const help = txt("div", pad.notice, "calc-pad-message");
    holder.append(help);
    const grid = node("div", "calc-pad-grid");
    const keys = ["7","8","9","÷","4","5","6","×","1","2","3","−","C","0",".","+","(",")","⌫","="];
    const adjust = k => {
      if (k === "C") pad.expression = "";
      else if (k === "⌫") pad.expression = pad.expression.slice(0, -1);
      else if (k === "=") {
        try {
          const value = core.evaluate(pad.expression);
          const str = core.stringify(value, 6);
          const target = getTarget(pad.target);
          target.assign(str);
          page.keypad = null;
          repaint();
        } catch (error) { help.textContent = error.message || "数式を確認してください。"; }
        return;
      } else {
        if (pad.expression.length >= 120) { help.textContent = "数式は120文字までです。"; return; }
        pad.expression += ({ "÷": "/", "×": "*", "−": "-" }[k] || k);
      }
      display.textContent = pad.expression || "0";
      help.textContent = "";
    };
    for (const key of keys) grid.append(button(key, () => adjust(key),
      "calc-pad-key" + (key === "=" ? " calc-pad-equals" : "")));
    holder.append(grid);
    return holder;
  }
  function renderTop(main) {
    main.append(txt("h1", "数値計算", "calc-title"));
    const recent = (page.ctx.state.calculationRecent || []).filter(id => TOOLS[id]).slice(0, 3);
    if (recent.length) {
      const section = node("section", "calc-recent");
      section.append(txt("h2", "最近使った計算"));
      for (const id of recent) section.append(button(TOOLS[id][0], () => openTool(id), "calc-recent-button"));
      main.append(section);
    }
    const grid = node("div", "calc-categories");
    for (const c of CATEGORIES) {
      const btn = button("", () => go("category", c.id), "calc-category");
      btn.append(txt("span", c.icon, "calc-category-icon"), txt("strong", c.label));
      btn.append(txt("small", c.tools.map(t => TOOLS[t][0]).join("・")));
      grid.append(btn);
    }
    main.append(grid);
  }
  function renderCategory(main) {
    const cat = CATEGORIES.find(c => c.id === page.category) || CATEGORIES[0];
    main.append(button("← 数値計算のトップ", () => go("categories"), "calc-back"));
    main.append(txt("h1", cat.label, "calc-title"));
    for (const id of cat.tools) {
      const b = button("", () => openTool(id), "calc-tool-link");
      b.append(txt("strong", TOOLS[id][0]), txt("small", TOOLS[id][1]), txt("span", "›", "calc-chevron"));
      main.append(b);
    }
  }
  function renderTool(main) {
    const id = page.tool;
    const cat = categoryFor(id);
    main.append(button(page.returnToTravel && id === "fare-items" ? "← 出張旅費へ" : "← " + cat.label,
      () => {
        if (page.returnToTravel && id === "fare-items") {
          draft("travel-estimate").options.fareMode = "items";
          page.returnToTravel = false;
          go("tool", "travel", "travel-estimate");
        } else go("category", cat.id);
      }, "calc-back"));
    main.append(txt("h1", TOOLS[id][0], "calc-title"));
    const area = node("section", "calc-form");
    addFields(area, id);
    main.append(area);
    const results = node("section", "calc-results");
    results.append(txt("h2", "計算結果"));
    resultSlot = node("div", "calc-results-body");
    results.append(resultSlot);
    main.append(results);
    main.append(button("入力をクリア", () => { delete page.drafts[id]; page.keypad = null; repaint(); },
      "calc-button calc-clear"));
    updateResults();
    if (page.keypad) {
      main.classList.add("calc-keypad-visible");
      main.append(padPanel());
    } else main.classList.remove("calc-keypad-visible");
  }
  function repaint() {
    if (!page.main) return;
    page.main.replaceChildren();
    page.main.classList.remove("calc-keypad-visible");
    resultSlot = null;
    if (page.screen === "categories") renderTop(page.main);
    else if (page.screen === "category") renderCategory(page.main);
    else if (page.screen === "tool") renderTool(page.main);
  }
  function render(main, ctx) {
    page.main = main; page.ctx = ctx;
    repaint();
  }
  root.UraCalculations = { render, categories: CATEGORIES, tools: TOOLS };
})(typeof window !== "undefined" ? window : globalThis);
