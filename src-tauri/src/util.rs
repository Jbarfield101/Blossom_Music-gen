use std::{collections::HashSet, fs, path::Path};

pub fn list_from_dir<P: AsRef<Path>>(dir: P) -> Result<Vec<String>, String> {
    let dir = dir.as_ref();
    let mut items = HashSet::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(name) = entry.path().file_name().and_then(|s| s.to_str()) {
            let stem = name.split('.').next().unwrap_or(name);
            items.insert(stem.to_string());
        }
    }
    let mut items: Vec<String> = items.into_iter().collect();
    items.sort();
    Ok(items)
}
