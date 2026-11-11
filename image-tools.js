"use strict";
// うらちゃんツール：画像変換。選択した画像だけをメモリ上で処理し、永続保存しません。
(() => {
  const MAX_FILES = 30;
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const MAX_TOTAL_SIZE = 250 * 1024 * 1024;
  const MAX_PIXELS = 48 * 1000 * 1000;
  const SUPPORTED = /\.(jpe?g|png|heic|heif)$/i;
  const MIME = /^(image\/jpeg|image\/png|image\/heic|image\/heif)$/i;
  const choices = { size: "1600", quality: 80, format: "jpeg" };
  const items = [];
  let busy = false;
  let view = null;
  let nextId = 0;
  let heiferPromise = null;
  let zipPromise = null;
  let message = "画像はこのPC内だけで処理され、保存されません。";

  const element = (tag, className, content) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (content !== undefined) n.textContent = content;
    return n;
  };
  const bytes = (amount) => {
    if (amount < 1024) return amount + " B";
    if (amount < 1024 * 1024) return (amount / 1024).toFixed(1) + " KB";
    return (amount / (1024 * 1024)).toFixed(2) + " MB";
  };
  const isImage = (file) => Boolean(file && typeof file.name === "string"
    && typeof file.size === "number" && file.size > 0
    && SUPPORTED.test(file.name) && (!file.type || file.type === "application/octet-stream" || MIME.test(file.type)));
  const isHeic = (file) => /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type || "");
  const longSideSize = (width, height, maximum) => {
    const size = Number(maximum);
    const ratio = !size || maximum === "original" ? 1 : Math.min(1, size / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
  };
  const cleanStem = (filename) => {
    const original = String(filename).replace(/\.[^.]+$/, "");
    const cleaned = original.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
    return (cleaned || "image").slice(0, 120);
  };
  const uniqueFilename = (filename, ext, used) => {
    const base = cleanStem(filename);
    let name = base + "." + ext;
    let suffix = 2;
    while (used.has(name.toLowerCase())) name = base + "-" + suffix++ + "." + ext;
    used.add(name.toLowerCase());
    return name;
  };
  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = element("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const getHeifer = async () => {
    if (!heiferPromise) {
      heiferPromise = import("./vendor/heic/heifer.js")
        .then(async (module) => {
          await module.default({ module_or_path: chrome.runtime.getURL("vendor/heic/heifer_bg.wasm") });
          return module;
        }).catch((error) => { heiferPromise = null; throw error; });
    }
    return heiferPromise;
  };
  const decodeHeic = async (file) => {
    const heifer = await getHeifer();
    const decoded = heifer.decode(new Uint8Array(await file.arrayBuffer()));
    try {
      const width = decoded.width;
      const height = decoded.height;
      if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
        throw Error("画像の画素数が処理上限を超えています。");
      }
      const rgba = new Uint8ClampedArray(decoded.rgba);
      const data = new ImageData(rgba, width, height);
      return await createImageBitmap(data);
    } finally {
      decoded.free();
    }
  };
  const encode = (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size === 0 || blob.type !== type) reject(Error("画像の書き出しに失敗しました。"));
      else resolve(blob);
    }, type, quality);
  });
  const convertImage = async (file, settings) => {
    const bitmap = isHeic(file)
      ? await decodeHeic(file)
      : await createImageBitmap(file, { imageOrientation: "from-image" });
    let canvas;
    try {
      if (bitmap.width * bitmap.height > MAX_PIXELS) throw Error("画像の画素数が処理上限を超えています。");
      const size = longSideSize(bitmap.width, bitmap.height, settings.size);
      canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("画像処理を開始できません。");
      if (settings.format === "jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const type = settings.format === "png" ? "image/png" : "image/jpeg";
      return await encode(canvas, type, settings.quality / 100);
    } finally {
      bitmap.close?.();
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  };
  const loadZip = async () => {
    if (window.JSZip) return window.JSZip;
    if (!zipPromise) {
      zipPromise = new Promise((resolve, reject) => {
        const script = element("script");
        script.src = chrome.runtime.getURL("vendor/jszip/jszip.min.js");
        script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(Error("ZIPライブラリが見つかりません。"));
        script.onerror = () => reject(Error("ZIPライブラリを読み込めません。"));
        document.head.append(script);
      }).catch((error) => { zipPromise = null; throw error; });
    }
    return zipPromise;
  };
  const notifyUser = (text) => {
    if (typeof notify === "function") notify(text);
    else message = text;
  };
  const updateMessage = (value) => {
    message = value;
    if (view) view.message.textContent = value;
  };
  const refresh = () => {
    if (!view) return;
    view.list.replaceChildren();
    const total = items.reduce((n, entry) => n + entry.file.size, 0);
    view.summary.textContent = "選択中 " + items.length + "枚 / " + bytes(total);
    view.clear.disabled = busy || items.length === 0;
    view.convert.disabled = busy || items.length === 0;
    view.pick.disabled = busy;
    view.size.disabled = busy;
    view.formatInputs.forEach((input) => { input.disabled = busy; });
    view.quality.disabled = busy;
    view.qualityRow.hidden = choices.format === "png";
    view.convert.textContent = busy ? "変換中…" : items.length + "枚を変換して保存";
    view.drop.classList.toggle("processing", busy);
    for (const entry of items) {
      const row = element("div", "image-file-row");
      const meta = element("div", "image-file-meta");
      meta.append(element("strong", "", entry.file.name));
      const info = element("small", "", bytes(entry.file.size) + " ・ " + entry.status);
      if (entry.failed) info.className = "image-file-error";
      meta.append(info);
      const remove = element("button", "image-remove", "×");
      remove.type = "button";
      remove.title = entry.file.name + "を除外";
      remove.setAttribute("aria-label", entry.file.name + "を除外");
      remove.disabled = busy;
      remove.addEventListener("click", () => {
        const index = items.findIndex((candidate) => candidate.id === entry.id);
        if (index >= 0) items.splice(index, 1);
        refresh();
      });
      row.append(meta, remove);
      view.list.append(row);
    }
  };
  const clearStatuses = () => {
    for (const item of items) { item.status = "待機中"; item.failed = false; }
    updateMessage("設定を確認して「変換して保存」を押してください。");
    refresh();
  };
  const addFiles = (files) => {
    if (busy) return;
    let invalid = 0;
    let oversized = 0;
    let duplicated = 0;
    let overLimit = 0;
    let total = items.reduce((n, entry) => n + entry.file.size, 0);
    for (const file of Array.from(files || [])) {
      if (!isImage(file)) { invalid++; continue; }
      if (file.size > MAX_FILE_SIZE) { oversized++; continue; }
      if (items.some((entry) => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) {
        duplicated++; continue;
      }
      if (items.length >= MAX_FILES || total + file.size > MAX_TOTAL_SIZE) { overLimit++; continue; }
      items.push({ id: ++nextId, file, status: "待機中", failed: false });
      total += file.size;
    }
    const warnings = [];
    if (invalid) warnings.push("非対応形式・空ファイル " + invalid + "件");
    if (oversized) warnings.push("50MB超 " + oversized + "件");
    if (duplicated) warnings.push("重複 " + duplicated + "件");
    if (overLimit) warnings.push("件数・合計容量の上限超 " + overLimit + "件");
    updateMessage(warnings.length ? "追加しなかった画像：" + warnings.join("、") : "画像を追加しました。元のファイルは変更されません。");
    refresh();
  };
  const convertAll = async () => {
    if (!items.length || busy) return;
    busy = true;
    updateMessage("変換中です。サイドパネルを閉じないでください。");
    refresh();
    const settings = { ...choices };
    const result = [];
    const used = new Set();
    let failure = 0;
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        item.status = (i + 1) + "/" + items.length + " 処理中";
        item.failed = false;
        refresh();
        // 次の描画機会を渡し、進捗表示を見えるようにする。
        await new Promise((resolve) => setTimeout(resolve, 0));
        try {
          const blob = await convertImage(item.file, settings);
          const name = uniqueFilename(item.file.name, settings.format === "jpeg" ? "jpg" : "png", used);
          result.push({ name, blob });
          const difference = Math.round((1 - blob.size / item.file.size) * 100);
          item.status = bytes(blob.size) + "（" + (difference >= 0 ? difference + "%削減" : Math.abs(difference) + "%増加") + "）";
        } catch (error) {
          failure++;
          item.failed = true;
          item.status = "失敗：" + (error && error.message ? error.message : "この画像を変換できません。");
        }
        refresh();
      }
      if (result.length === 1) {
        download(result[0].blob, result[0].name);
      } else if (result.length > 1) {
        updateMessage("ZIPファイルを準備しています。");
        const JSZip = await loadZip();
        const zip = new JSZip();
        for (const entry of result) zip.file(entry.name, entry.blob);
        const archive = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true });
        const date = new Date().toISOString().slice(0, 10);
        download(archive, "urachan-images-" + date + ".zip");
      }
      if (result.length) updateMessage(result.length + "枚のダウンロードを開始しました。" + (failure ? " 変換失敗：" + failure + "枚。" : ""));
      else updateMessage("変換できる画像がありませんでした。各画像のエラーを確認してください。");
    } catch (error) {
      updateMessage("保存の準備に失敗しました：" + (error && error.message ? error.message : "もう一度お試しください。"));
      notifyUser(message);
    } finally {
      busy = false;
      refresh();
    }
  };
  const selectField = (label, options, value, onChange) => {
    const field = element("label", "image-setting-field");
    field.append(element("span", "", label));
    const select = element("select");
    for (const [key, caption] of options) {
      const option = element("option", "", caption);
      option.value = key;
      select.append(option);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    field.append(select);
    return { field, select };
  };
  function renderImageTools(main) {
    main.append(element("h1", "page-heading", "画像変換"));
    main.append(element("p", "explain", "写真のサイズ変更・圧縮・HEIC変換を、PC内だけで実行します。"));
    const drop = element("div", "image-drop-zone");
    drop.tabIndex = 0;
    drop.setAttribute("role", "button");
    drop.setAttribute("aria-label", "画像を選択、またはここにドロップ");
    drop.append(element("span", "image-drop-icon", "⇪"));
    drop.append(element("strong", "", "ここに画像をドロップ"));
    drop.append(element("small", "", "JPEG / PNG / HEIC（複数可）"));
    const pick = element("button", "button button-secondary", "ファイルを選択");
    pick.type = "button";
    const input = element("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif";
    input.hidden = true;
    input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
    pick.addEventListener("click", () => input.click());
    drop.addEventListener("click", (event) => { if (event.target !== pick && !pick.contains(event.target) && !busy) input.click(); });
    drop.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === drop && !busy) { event.preventDefault(); input.click(); }
    });
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!busy) drop.classList.add("dragover");
    });
    drop.addEventListener("dragleave", (event) => {
      if (!drop.contains(event.relatedTarget)) drop.classList.remove("dragover");
    });
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      drop.classList.remove("dragover");
      addFiles(event.dataTransfer?.files);
    });
    drop.append(pick, input);
    main.append(drop);

    const card = element("section", "card image-converter-card");
    const heading = element("div", "image-files-heading");
    const summary = element("strong");
    const clear = element("button", "button button-plain", "すべて削除");
    clear.type = "button";
    clear.addEventListener("click", () => { if (!busy) { items.length = 0; clearStatuses(); } });
    heading.append(summary, clear);
    const list = element("div", "image-file-list");
    card.append(heading, list);
    main.append(card);

    const settings = element("section", "card image-converter-card");
    settings.append(element("h2", "", "変換設定"));
    const size = selectField("画像サイズ（長辺）", [
      ["original", "変更しない"], ["1600", "1600px（標準）"],
      ["1200", "1200px（軽量）"], ["800", "800px（小さめ）"]
    ], choices.size, (value) => { choices.size = value; clearStatuses(); });
    const formatField = element("fieldset", "image-format-field");
    formatField.append(element("legend", "", "保存形式"));
    const formatOptions = element("div", "image-format-options");
    const formatInputs = [];
    for (const [value, caption] of [["jpeg", "JPEG"], ["png", "PNG"]]) {
      const option = element("label", "image-format-option");
      const radio = element("input");
      radio.type = "radio";
      radio.name = "image-output-format";
      radio.value = value;
      radio.checked = choices.format === value;
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        choices.format = value;
        clearStatuses();
      });
      option.append(radio, element("span", "", caption));
      formatOptions.append(option);
      formatInputs.push(radio);
    }
    formatField.append(formatOptions);
    const qualityRow = element("label", "image-setting-field");
    const qualityHeading = element("span", "", "JPEG画質 ");
    const qualityText = element("strong", "", choices.quality + "%");
    qualityHeading.append(qualityText);
    const quality = element("input");
    quality.type = "range";
    quality.min = "40"; quality.max = "100"; quality.step = "5"; quality.value = String(choices.quality);
    quality.addEventListener("input", () => { choices.quality = Number(quality.value); qualityText.textContent = choices.quality + "%"; });
    quality.addEventListener("change", clearStatuses);
    qualityRow.append(qualityHeading, quality);
    settings.append(size.field, formatField, qualityRow);
    settings.append(element("p", "help", "縦横比を維持し、小さい画像は拡大しません。JPEG化した透過画像の背景は白になります。"));
    main.append(settings);

    const convert = element("button", "button button-primary full image-convert-action");
    convert.type = "button";
    convert.addEventListener("click", () => { void convertAll(); });
    const status = element("p", "image-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    main.append(convert, status);
    main.append(element("p", "help", "元画像は変更しません。1枚は画像、複数枚はZIPで保存します。GPS・撮影情報は原則引き継ぎません。"));
    view = { drop, pick, list, summary, clear, size: size.select, formatInputs, quality, qualityRow, convert, message: status };
    updateMessage(message);
    refresh();
  }
  window.UraImageTools = Object.freeze({
    render: renderImageTools,
    // 純粋関数のみテストから参照します。
    helpers: Object.freeze({ isImage, longSideSize, cleanStem, uniqueFilename })
  });
})();