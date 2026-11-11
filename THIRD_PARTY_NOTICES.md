# 同梱ソフトウェアとライセンス / Third-party notices

うらちゃんツール本体の独自実装は [MIT License](LICENSE) です。
画像変換は外部サーバーへ送信せず、ローカルで処理します。

## HEIC / HEIF デコーダー（heifer）

- ソフトウェア：**heifer v0.5.0**（Pure Rust HEIC/HEIF decoder）
- 上流ソース：https://github.com/HarpeLm/Heifer/tree/v0.5.0
- ライセンス：**MIT OR Apache-2.0**。この配布ではMITの条件を利用します。
- ライセンス本文：`vendor/heic/LICENSE-HEIFER-MIT`
- 組み込み方法：デコード専用の `heifer` を、`heifer-wasm/` の橋渡しコードからWebAssemblyにコンパイルします。
- 配布物：`vendor/heic/heifer.js` と `vendor/heic/heifer_bg.wasm`。ソース・ビルド手順は `heifer-wasm/` を参照。
- **libheif / libde265 等のLGPL実装は含めません。** 配布ビルドではRust依存パッケージの宣言ライセンスにLGPL/AGPLがないことを確認します。

## WebAssembly JavaScript 接続（wasm-bindgen）

- ソフトウェア：**wasm-bindgen v0.2.129**
- 上流ソース：https://github.com/wasm-bindgen/wasm-bindgen
- ライセンス：**MIT OR Apache-2.0**。この配布ではMITの条件を利用します。
- ライセンス本文：`vendor/heic/LICENSE-WASM-BINDGEN-MIT`
- JavaScript接続コードはビルド時に生成します。開発者がCDNから読み込むことはありません。

## ZIP アーカイブ作成

- ソフトウェア：**JSZip v3.10.1**
- ライセンス：**MIT**（MIT/GPLv3デュアルライセンスのうちMITを選択）
- 同梱ファイル：`vendor/jszip/jszip.min.js`
- ライセンス本文：`vendor/jszip/LICENSE-MIT.txt`
- 上流ソース：https://github.com/Stuk/jszip

## 配布上の注意

- リリースZIPにはライセンス本文と上記のコードを同梱します。
- LGPLを使用しないことと、HEVC/H.265の特許許諾は別問題です。配布形態に応じて特許上の条件をご確認ください。
- この文書は法律上の適合性を保証するものではありません。
