use wasm_bindgen::prelude::*;
use addr2line::Context;
use js_sys::{Array, Object as JsObject, Reflect};

#[wasm_bindgen]
pub fn resolve_symbols(buffer: &[u8], addresses: &[u64]) -> Result<Array, JsValue> {
    // 1. Parse the file and build the DWARF context EXACTLY ONCE
    let file = object::File::parse(buffer)
        .map_err(|_| JsValue::from_str("Failed to parse ELF file"))?;
        
    let context = Context::new(&file)
        .map_err(|_| JsValue::from_str("Failed to parse DWARF data"))?;

    // 2. Prepare a standard JavaScript Array to return
    let results = Array::new();

    let file_key = JsValue::from_str("file");
    let line_key = JsValue::from_str("line");

    // 3. Loop through all addresses at native Rust speeds
    for &address in addresses {
        let mut loc_obj = JsValue::NULL;

        // Skip 0x0 addresses safely
        if address != 0 {
            if let Ok(Some(location)) = context.find_location(address) {
                let obj = JsObject::new();
                
                if let Some(file_name) = location.file {
                    Reflect::set(&obj, &file_key, &JsValue::from_str(file_name))?;
                }
                if let Some(line_number) = location.line {
                    Reflect::set(&obj, &line_key, &JsValue::from_f64(line_number as f64))?;
                }
                
                loc_obj = JsValue::from(obj);
            }
        }
        
        results.push(&loc_obj);
    }

    Ok(results)
}
