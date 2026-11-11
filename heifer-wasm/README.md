# HEIC デコード用 WASM

- `heifer` v0.5.0 (MIT OR Apache-2.0) のデコード専用構成を使用。
- Rust / WASM は開発・ビルド時のみ必要。利用者はリリースZIPを展開するだけ。
- GitHub Actionsで `cargo build --release --target wasm32-unknown-unknown` と `wasm-bindgen --target web` を実行して `vendor/heic/heifer.js` と `vendor/heic/heifer_bg.wasm` を生成する。
- 生成物はGitで管理せず、GitHub ReleasesのZIPに同梱する。
- HEIC処理時のみ遅延読込し、表示色はsRGBに変換。上限は4,800万画素。
- `heifer` の原典: https://github.com/HarpeLm/Heifer/tree/v0.5.0
- 同梱する第三者ライセンスの詳細はリポジトリ直下 `THIRD_PARTY_NOTICES.md` を参照。
