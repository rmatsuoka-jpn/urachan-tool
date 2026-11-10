# 同梱ソフトウェアとライセンス / Third-party notices

うらちゃんツール本体の独自実装は [MIT License](LICENSE) で公開しています。
下記の同梱部品は、それぞれのライセンスが優先されます。**本体のMIT表記を理由に、LGPL部品までMITと解釈しないでください。**
画像変換処理は外部サーバーへ画像を送信せず、ローカルファイルから読み込む方式です。

## HEIC / HEIF デコーダー

- 同梱ファイル：`vendor/heic/libheif-bundle.mjs`（独立ファイルとして配置）
- ライセンス：**GNU Lesser General Public License v3 (LGPL-3.0)**。依存する libheif / libde265 等もLGPL系の条件を確認してください。
- 配布ライセンス本文：`vendor/heic/LICENSE`（LGPL-3.0）、`vendor/heic/GPL-3.0.txt`（GPL-3.0、LGPL-3.0が参照）
- 取得元：Cleanor Labs / Image Compressor Chrome Extension
  - https://github.com/cleanor-app/image-compressor-chrome-extension/blob/main/vendor/heic/libheif-bundle.mjs
  - https://github.com/cleanor-app/image-compressor-chrome-extension/blob/main/vendor/heic/LICENSE
- デコーダーの上流ソース・ビルド情報：
  - https://github.com/catdad-experiments/libheif-js
  - https://github.com/strukturag/libheif
  - https://github.com/strukturag/libde265
- このファイルは別ファイルで読み込むため、交換・改変したバージョンで動作を確認できます。**改変版を配布する場合もLGPLのソース公開・再リンク／交換可能性等の条件を確認してください。**
- 同梱バイナリに対応する正確な上流ビルド構成・依存バージョンおよび再現可能なソースの確定は配布前の確認事項です。LGPL遵守はライセンス文書の同梱だけで完了するものではありません。

## ZIP アーカイブ作成

- 同梱ファイル：`vendor/jszip/jszip.min.js`
- ソフトウェア：**JSZip v3.10.1** / Stuart Knightley、David Duponchel、Franz Buchinger、António Afonso
- ライセンス：**MIT**（MIT/GPLv3デュアルライセンスのうちMITを選択）
- ライセンス本文：`vendor/jszip/LICENSE-MIT.txt`
- 取得元：https://github.com/cleanor-app/image-compressor-chrome-extension/blob/main/vendor/jszip/jszip.min.js
- 上流ソース：https://github.com/Stuk/jszip

## 参考実装について

UIや機能設計の参考：https://github.com/cleanor-app/image-compressor-chrome-extension
この参照先のアプリケーション部分は MIT（© 2026 Cleanor Labs）です。
本リポジトリの画像変換画面・操作処理は独自実装であり、ライブラリ部分以外のコードを丸ごとコピーしていません。

## 配布者向け

- 配布ZIPに`LICENSE`、`THIRD_PARTY_NOTICES.md`、`vendor/`内のライセンス文書・実行ファイルを含めます。
- LGPL部品の改変版や再配布を行う場合、上記の案内だけでは足りない可能性があるため、対象バージョンの対応ソース・ビルド手順・交換手段を用意してください。
- 法律上の適合性を保証する文書ではありません。
