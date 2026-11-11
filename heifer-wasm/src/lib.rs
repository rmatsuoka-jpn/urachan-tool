//! HEIC/HEIF decode-only bridge for the Chrome extension.
//! The heifer crate performs the decode locally, with colour conversion to sRGB.
use wasm_bindgen::prelude::*;

const MAX_PIXELS: u64 = 48_000_000;

#[wasm_bindgen]
pub struct Decoded {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[wasm_bindgen]
impl Decoded {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 { self.width }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 { self.height }

    #[wasm_bindgen(getter)]
    pub fn rgba(&self) -> Vec<u8> { self.rgba.clone() }
}

#[wasm_bindgen]
pub fn decode(bytes: &[u8]) -> Result<Decoded, JsError> {
    let options = heifer::Options { max_threads: 1, max_pixels: MAX_PIXELS };
    let image = heifer::decode_srgb_rgba8(bytes, &options)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Ok(Decoded { width: image.width, height: image.height, rgba: image.data })
}
