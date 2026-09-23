use std::borrow::Cow;
use std::collections::HashMap;

use wasm_bindgen::prelude::*;
use addr2line::Context;
use js_sys::{Array, Object as JsObject, Reflect};
use object::{Object, ObjectSection};

/// Data symbols (e.g. `__init_*` entries placed via linker section macros) have no
/// instructions, so `.debug_line` never covers their address and `find_location` fails.
/// `nm` instead resolves them via the `DW_AT_decl_file`/`DW_AT_decl_line` attributes on the
/// matching `DW_TAG_variable`/`DW_TAG_subprogram` DIE, so we build that name -> location map too.
fn build_decl_location_map(file: &object::File) -> HashMap<String, (String, u32)> {
    let endian = if file.is_little_endian() {
        gimli::RunTimeEndian::Little
    } else {
        gimli::RunTimeEndian::Big
    };

    let load_section = |id: gimli::SectionId| -> Result<Cow<[u8]>, gimli::Error> {
        match file.section_by_name(id.name()) {
            Some(section) => Ok(section
                .uncompressed_data()
                .unwrap_or(Cow::Borrowed(&[][..]))),
            None => Ok(Cow::Borrowed(&[][..])),
        }
    };

    let mut map = HashMap::new();

    let dwarf_cow = match gimli::Dwarf::load(load_section) {
        Ok(dwarf) => dwarf,
        Err(_) => return map,
    };
    let borrow_section: &dyn for<'a> Fn(&'a Cow<[u8]>) -> gimli::EndianSlice<'a, gimli::RunTimeEndian> =
        &|section| gimli::EndianSlice::new(section, endian);
    let dwarf = dwarf_cow.borrow(&borrow_section);

    let mut unit_headers = dwarf.units();
    while let Ok(Some(header)) = unit_headers.next() {
        let unit = match dwarf.unit(header) {
            Ok(unit) => unit,
            Err(_) => continue,
        };
        let line_header = match &unit.line_program {
            Some(program) => program.header().clone(),
            None => continue,
        };

        let mut entries = unit.entries();
        while let Ok(Some((_, entry))) = entries.next_dfs() {
            if entry.tag() != gimli::DW_TAG_variable && entry.tag() != gimli::DW_TAG_subprogram {
                continue;
            }

            let name = match entry.attr_value(gimli::DW_AT_name) {
                Ok(Some(attr)) => match dwarf.attr_string(&unit, attr) {
                    Ok(r) => r.to_string_lossy().into_owned(),
                    Err(_) => continue,
                },
                _ => continue,
            };

            let decl_line = match entry.attr_value(gimli::DW_AT_decl_line) {
                Ok(Some(attr)) => attr.udata_value(),
                _ => None,
            };
            // `udata_value()` doesn't understand the `FileIndex` variant, so match it directly.
            let decl_file_index = match entry.attr_value(gimli::DW_AT_decl_file) {
                Ok(Some(gimli::AttributeValue::FileIndex(index))) => Some(index),
                Ok(Some(attr)) => attr.udata_value(),
                _ => None,
            };

            if let (Some(line), Some(file_index)) = (decl_line, decl_file_index) {
                if let Some(file_entry) = line_header.file(file_index) {
                    if let Ok(path_name) = dwarf.attr_string(&unit, file_entry.path_name()) {
                        let mut path = String::new();
                        if let Some(dir_attr) = file_entry.directory(&line_header) {
                            if let Ok(dir) = dwarf.attr_string(&unit, dir_attr) {
                                let dir = dir.to_string_lossy();
                                if !dir.is_empty() {
                                    path.push_str(&dir);
                                    path.push('/');
                                }
                            }
                        }
                        path.push_str(&path_name.to_string_lossy());
                        map.entry(name).or_insert((path, line as u32));
                    }
                }
            }
        }
    }

    map
}

#[wasm_bindgen]
pub fn resolve_symbols(buffer: &[u8], addresses: &[u64], names: Vec<String>) -> Result<Array, JsValue> {
    // 1. Parse the file and build the DWARF context EXACTLY ONCE
    let file = object::File::parse(buffer)
        .map_err(|_| JsValue::from_str("Failed to parse ELF file"))?;
        
    let context = Context::new(&file)
        .map_err(|_| JsValue::from_str("Failed to parse DWARF data"))?;

    let decl_locations = build_decl_location_map(&file);

    // 2. Prepare a standard JavaScript Array to return
    let results = Array::new();

    let file_key = JsValue::from_str("file");
    let line_key = JsValue::from_str("line");

    // 3. Loop through all addresses at native Rust speeds
    for (i, &address) in addresses.iter().enumerate() {
        let mut loc_obj = JsValue::NULL;

        // Skip 0x0 addresses safely
        if address != 0 {
            let location = context
                .find_location(address)
                .ok()
                .flatten()
                .filter(|location| location.file.is_some() || location.line.is_some());

            if let Some(location) = location {
                let obj = JsObject::new();

                if let Some(file_name) = location.file {
                    Reflect::set(&obj, &file_key, &JsValue::from_str(file_name))?;
                }
                if let Some(line_number) = location.line {
                    Reflect::set(&obj, &line_key, &JsValue::from_f64(line_number as f64))?;
                }

                loc_obj = JsValue::from(obj);
            } else if let Some((decl_file, decl_line)) =
                names.get(i).and_then(|name| decl_locations.get(name))
            {
                // Fall back to the DWARF declaration site for data symbols with no line-table entry.
                let obj = JsObject::new();
                Reflect::set(&obj, &file_key, &JsValue::from_str(decl_file))?;
                Reflect::set(&obj, &line_key, &JsValue::from_f64(*decl_line as f64))?;
                loc_obj = JsValue::from(obj);
            }
        }
        
        results.push(&loc_obj);
    }

    Ok(results)
}
