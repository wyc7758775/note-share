// NoteShare 桌面端命令：与 scripts/dev-server.mjs 的 /api 一一对应。
// 所有 path 参数都是 vault 内相对路径（正斜杠），写入前统一做越界检查。
use base64::Engine;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

struct AppState {
    vault: Mutex<Option<PathBuf>>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            vault: Mutex::new(None),
        })
        .setup(|app| {
            if let Ok(cfg) = app.path().app_config_dir() {
                let file = cfg.join("vault.json");
                if let Ok(txt) = fs::read_to_string(&file) {
                    if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                        if let Some(dir) = v["vault"].as_str() {
                            let st = app.state::<AppState>();
                            *st.vault.lock().unwrap() = Some(PathBuf::from(dir));
                        }
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_name, set_vault, tree, read_note, write_note, create_note, create_folder,
            rename_path, delete_path, search, read_scene, save_scene, save_asset, read_asset,
            save_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ---------- 基础工具 ----------

fn to_posix(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn sanitize_name(name: &str, keep_ext: bool) -> String {
    let mut n: String = name
        .chars()
        .filter(|c| !r#"\/:*?"<>|#^[]"#.contains(*c))
        .collect();
    n = n.trim().to_string();
    if !keep_ext {
        if let Some(stripped) = n.strip_suffix(".md") {
            n = stripped.to_string();
        }
    }
    n
}

fn vault_of(state: &State<AppState>) -> Result<PathBuf, String> {
    state
        .vault
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "尚未选择笔记库文件夹".to_string())
}

/// 把 vault 相对路径解析为绝对路径，拒绝越界（.. 等）
fn resolve_inside(vault: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.split(['/', '\\']).any(|seg| seg == "..") {
        return Err("非法路径".into());
    }
    let abs = vault.join(rel.trim_start_matches("./"));
    if abs == *vault || abs.starts_with(vault) {
        Ok(abs)
    } else {
        Err("非法路径".into())
    }
}

fn unique_abs(abs: &Path) -> PathBuf {
    if !abs.exists() {
        return abs.to_path_buf();
    }
    let ext = abs.extension().and_then(|e| e.to_str()).unwrap_or("");
    let stem = abs.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let dir = abs.parent().unwrap_or(Path::new("."));
    for i in 2..1000 {
        let name = if ext.is_empty() {
            format!("{stem}-{i}")
        } else {
            format!("{stem}-{i}.{ext}")
        };
        let cand = dir.join(name);
        if !cand.exists() {
            return cand;
        }
    }
    abs.with_extension("overflow")
}

fn kind_of(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.ends_with(".md") {
        "note"
    } else if matches!(
        lower.rsplit('.').next(),
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "excalidraw" | "mp4" | "webm" | "pdf")
    ) {
        "asset"
    } else {
        "other"
    }
}

fn build_tree(dir: &Path, rel: &str, out: &mut Vec<Value>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut folders: Vec<Value> = vec![];
    let mut notes: Vec<Value> = vec![];
    let mut assets: Vec<Value> = vec![];
    let mut others: Vec<Value> = vec![];
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let child_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let ft = match e.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_dir() {
            let mut children = vec![];
            build_tree(&e.path(), &child_rel, &mut children);
            folders.push(json!({"name": name, "path": child_rel, "kind": "folder", "children": children}));
        } else {
            let node = json!({"name": name, "path": child_rel, "kind": kind_of(&name)});
            match kind_of(&name) {
                "note" => notes.push(node),
                "asset" => assets.push(node),
                _ => others.push(node),
            }
        }
    }
    let cmp = |a: &Value, b: &Value| {
        a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
    };
    folders.sort_by(cmp);
    notes.sort_by(cmp);
    assets.sort_by(cmp);
    others.sort_by(cmp);
    out.extend(folders);
    out.extend(notes);
    out.extend(assets);
    out.extend(others);
}

fn walk_notes(dir: &Path, rel: &str, out: &mut Vec<(PathBuf, String)>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                walk_notes(&e.path(), &child_rel, out);
            } else if name.to_lowercase().ends_with(".md") {
                out.push((e.path(), child_rel));
            }
        }
    }
}

fn mime_of(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// 把索引对齐到 UTF-8 字符边界（防止中文搜索摘要切出乱码）
fn char_floor(s: &str, i: usize) -> usize {
    let mut i = i.min(s.len());
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn char_ceil(s: &str, i: usize) -> usize {
    let mut i = i.min(s.len());
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

// ---------- 命令 ----------

#[tauri::command]
fn vault_name(state: State<AppState>) -> Result<String, String> {
    let v = vault_of(&state)?;
    Ok(v
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("笔记库")
        .to_string())
}

#[tauri::command]
fn set_vault(app: AppHandle, dir: String) -> Result<(), String> {
    let p = PathBuf::from(&dir);
    if !p.is_dir() {
        return Err("不是有效的文件夹".into());
    }
    let st = app.state::<AppState>();
    *st.vault.lock().unwrap() = Some(p.clone());
    let cfg = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&cfg).map_err(|e| e.to_string())?;
    fs::write(
        cfg.join("vault.json"),
        serde_json::to_vec(&json!({"vault": dir})).unwrap(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn tree(state: State<AppState>) -> Result<Value, String> {
    let v = vault_of(&state)?;
    let mut out = vec![];
    build_tree(&v, "", &mut out);
    Ok(Value::Array(out))
}

#[tauri::command]
fn read_note(state: State<AppState>, path: String) -> Result<Value, String> {
    let v = vault_of(&state)?;
    let abs = resolve_inside(&v, &path)?;
    let raw = fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    Ok(json!({"path": path, "raw": raw}))
}

#[tauri::command]
fn write_note(state: State<AppState>, path: String, raw: String) -> Result<(), String> {
    let v = vault_of(&state)?;
    let abs = resolve_inside(&v, &path)?;
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(abs, raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_note(state: State<AppState>, folder: String, title: String) -> Result<String, String> {
    let v = vault_of(&state)?;
    let dir = if folder.is_empty() {
        v.clone()
    } else {
        resolve_inside(&v, &folder)?
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = {
        let s = sanitize_name(&title, false);
        if s.is_empty() { "未命名笔记".to_string() } else { s }
    };
    let abs = unique_abs(&dir.join(format!("{stem}.md")));
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let template = format!("---\ntags: []\ncreated: {now}\nupdated: {now}\n---\n\n");
    fs::write(&abs, template).map_err(|e| e.to_string())?;
    Ok(to_posix(&abs.strip_prefix(&v).map_err(|e| e.to_string())?))
}

#[tauri::command]
fn create_folder(state: State<AppState>, parent: String, name: String) -> Result<String, String> {
    let v = vault_of(&state)?;
    let dir = if parent.is_empty() {
        v.clone()
    } else {
        resolve_inside(&v, &parent)?
    };
    let n = {
        let s = sanitize_name(&name, true);
        if s.is_empty() { "新文件夹".to_string() } else { s }
    };
    let mut abs = dir.join(&n);
    let mut i = 2;
    while abs.exists() {
        abs = dir.join(format!("{n}-{i}"));
        i += 1;
    }
    fs::create_dir_all(&abs).map_err(|e| e.to_string())?;
    Ok(to_posix(&abs.strip_prefix(&v).map_err(|e| e.to_string())?))
}

#[tauri::command]
fn rename_path(state: State<AppState>, from: String, new_name: String) -> Result<String, String> {
    let v = vault_of(&state)?;
    let abs = resolve_inside(&v, &from)?;
    let is_note = from.to_lowercase().ends_with(".md");
    let mut n = sanitize_name(&new_name, false);
    if n.is_empty() {
        return Err("名称不能为空".into());
    }
    if is_note {
        n.push_str(".md");
    }
    let mut target = abs
        .parent()
        .unwrap_or(Path::new("."))
        .join(&n);
    if target != abs && target.exists() {
        // 撞名时自动加序号（与新建一致），保证自动保存不中断
        let ext = target.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
        let stem = target.file_stem().and_then(|s| s.to_str()).unwrap_or("file").to_string();
        let dir = target.parent().unwrap_or(Path::new("."));
        for i in 2..1000 {
            let name = if ext.is_empty() {
                format!("{stem}-{i}")
            } else {
                format!("{stem}-{i}.{ext}")
            };
            let cand = dir.join(name);
            if !cand.exists() {
                target = cand;
                break;
            }
        }
    }
    fs::rename(&abs, &target).map_err(|e| e.to_string())?;
    Ok(to_posix(&target.strip_prefix(&v).map_err(|e| e.to_string())?))
}

#[tauri::command]
fn delete_path(state: State<AppState>, path: String) -> Result<(), String> {
    let v = vault_of(&state)?;
    let abs = resolve_inside(&v, &path)?;
    let trash = v.join(".trash");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let stamp = chrono::Utc::now().timestamp();
    let base = abs
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("item")
        .to_string();
    fs::rename(&abs, trash.join(format!("{stamp}-{base}"))).map_err(|e| e.to_string())
}

#[tauri::command]
fn search(state: State<AppState>, q: String) -> Result<Value, String> {
    let v = vault_of(&state)?;
    let needle = q.to_lowercase();
    let mut files = vec![];
    walk_notes(&v, "", &mut files);
    let mut hits = vec![];
    for (abs, rel) in files {
        let text = match fs::read_to_string(&abs) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let low = text.to_lowercase();
        let title = rel
            .rsplit('/')
            .next()
            .unwrap_or(&rel)
            .trim_end_matches(".md")
            .to_string();
        let idx = low.find(&needle);
        let in_title = title.to_lowercase().contains(&needle);
        let idx = match idx {
            Some(i) => Some(i),
            None if in_title => None,
            None => continue,
        };
        let snippet = idx
            .map(|i| {
                let start = char_floor(&text, i.saturating_sub(40));
                let end = char_ceil(&text, (i + 60).min(text.len()));
                text[start..end].split_whitespace().collect::<Vec<_>>().join(" ")
            })
            .unwrap_or_default();
        hits.push(json!({"path": rel, "title": title, "snippet": snippet}));
        if hits.len() >= 50 {
            break;
        }
    }
    Ok(Value::Array(hits))
}

#[tauri::command]
fn read_scene(state: State<AppState>, path: String) -> Result<String, String> {
    let v = vault_of(&state)?;
    let abs = resolve_inside(&v, &path)?;
    fs::read_to_string(&abs).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_scene(
    state: State<AppState>,
    name: Option<String>,
    scene_json: String,
    png_base64: Option<String>,
) -> Result<Value, String> {
    let v = vault_of(&state)?;
    let dir = v.join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let scene_abs = match name {
        Some(n) => {
            let n = if n.to_lowercase().ends_with(".excalidraw") { n } else { format!("{n}.excalidraw") };
            resolve_inside(&v, &n)?
        }
        None => {
            let stamp = chrono::Utc::now().timestamp();
            unique_abs(&dir.join(format!("drawing-{stamp}.excalidraw")))
        }
    };
    fs::write(&scene_abs, scene_json).map_err(|e| e.to_string())?;
    let png_path = match &png_base64 {
        Some(b64) => {
            let png_abs = scene_abs.with_extension("png");
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| e.to_string())?;
            fs::write(&png_abs, bytes).map_err(|e| e.to_string())?;
            Some(to_posix(&png_abs.strip_prefix(&v).map_err(|e| e.to_string())?))
        }
        None => None,
    };
    Ok(json!({
        "scenePath": to_posix(&scene_abs.strip_prefix(&v).map_err(|e| e.to_string())?),
        "pngPath": png_path,
    }))
}

// 参数名 base64 与前端 invoke 键一致；函数内用 ::base64 引用 crate 避免遮蔽
#[tauri::command]
fn save_asset(state: State<AppState>, name: String, base64: String) -> Result<Value, String> {
    let v = vault_of(&state)?;
    let dir = v.join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let stem_raw = Path::new(&name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("asset");
    let stem = sanitize_name(stem_raw, true);
    let stem = if stem.is_empty() { "asset".to_string() } else { stem };
    let stem: String = stem.chars().take(40).collect();
    let ext_ok = matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "mp4" | "webm" | "pdf"
    );
    let file_ext = if ext_ok { ext.clone() } else { "png".to_string() };
    let abs = unique_abs(&dir.join(format!("{stem}.{file_ext}")));
    let bytes = ::base64::engine::general_purpose::STANDARD
        .decode(&base64)
        .map_err(|e| e.to_string())?;
    fs::write(&abs, bytes).map_err(|e| e.to_string())?;
    Ok(json!({"path": to_posix(&abs.strip_prefix(&v).map_err(|e| e.to_string())?)}))
}

#[tauri::command]
fn read_asset(state: State<AppState>, path: String) -> Result<Value, String> {
    let v = vault_of(&state)?;
    let abs = resolve_inside(&v, &path)?;
    let bytes = fs::read(&abs).map_err(|e| e.to_string())?;
    let ext = abs
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    Ok(json!({
        "base64": base64::engine::general_purpose::STANDARD.encode(bytes),
        "mime": mime_of(&ext),
    }))
}

/// 导出文件用：保存到用户通过对话框选择的绝对路径
#[tauri::command]
fn save_text_file(target: String, content: String) -> Result<(), String> {
    fs::write(&target, content).map_err(|e| e.to_string())
}
