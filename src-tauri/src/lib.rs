// NoteShare 桌面端命令：与 scripts/dev-server.mjs 的 /api 一一对应。
// 所有 path 参数都是 vault 内相对路径（正斜杠），写入前统一做越界检查。
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

struct AppState {
    vault: Mutex<Option<PathBuf>>,
}

// ---------- 仓库注册表（应用级配置，独立于任何 vault） ----------

/// vaults.json 里的一条仓库记录（serde camelCase 与前端 VaultInfo 对齐）
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultEntry {
    id: String,
    name: String,
    path: String,
    last_opened_at: u64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VaultRegistryFile {
    version: u8,
    vaults: Vec<VaultEntry>,
}

/// 返回给前端的仓库信息（多一个 exists，缺失的目录在 UI 上标灰）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultInfo {
    id: String,
    name: String,
    path: String,
    last_opened_at: u64,
    exists: bool,
}

impl From<&VaultEntry> for VaultInfo {
    fn from(e: &VaultEntry) -> Self {
        VaultInfo {
            id: e.id.clone(),
            name: e.name.clone(),
            path: e.path.clone(),
            last_opened_at: e.last_opened_at,
            exists: Path::new(&e.path).is_dir(),
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 生成仓库稳定 id：时间戳 + 路径的 FNV 哈希（无 uuid 依赖，碰撞概率可忽略）
fn gen_vault_id(path: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in format!("{}{}", nanos, path).as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("v{:016x}", h)
}

/// 路径等价比较：统一分隔符、去尾斜杠、Windows 下不区分大小写
fn same_path(a: &str, b: &str) -> bool {
    #[cfg(windows)]
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    #[cfg(not(windows))]
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    norm(a) == norm(b)
}

fn read_registry(app: &AppHandle) -> VaultRegistryFile {
    let Ok(cfg) = app.path().app_config_dir() else {
        return Default::default();
    };
    match fs::read_to_string(cfg.join("vaults.json")) {
        Ok(txt) => serde_json::from_str(&txt).unwrap_or_default(),
        Err(_) => Default::default(),
    }
}

fn write_registry(app: &AppHandle, reg: &VaultRegistryFile) -> Result<(), String> {
    let cfg = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&cfg).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(reg).map_err(|e| e.to_string())?;
    fs::write(cfg.join("vaults.json"), bytes).map_err(|e| e.to_string())
}

/// vault 内清单 .noteshare/vault.json：身份（id/name）随文件夹走，
/// 同一文件夹在另一台机器打开仍解析到同一 id（为将来同步认亲预留）。
fn read_manifest(vault: &Path) -> Option<Value> {
    let txt = fs::read_to_string(vault.join(".noteshare").join("vault.json")).ok()?;
    serde_json::from_str(&txt).ok()
}

fn write_manifest(vault: &Path, id: &str, name: &str) {
    // 只读文件系统等失败静默忽略：清单缺失时退化用注册表里的身份
    let _ = fs::create_dir_all(vault.join(".noteshare"));
    if let Ok(bytes) = serde_json::to_vec(&json!({"id": id, "name": name})) {
        let _ = fs::write(vault.join(".noteshare").join("vault.json"), bytes);
    }
}

/// 注册（或刷新）一条仓库并激活：身份优先取 vault 清单，其次注册表旧值，最后新建
fn upsert_and_activate(
    app: &AppHandle,
    state: &State<AppState>,
    path: &str,
    fallback_name: Option<String>,
) -> Result<VaultInfo, String> {
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err("文件夹不存在".into());
    }
    let manifest = read_manifest(&p);
    let mut reg = read_registry(app);
    let old = reg.vaults.iter().find(|v| same_path(&v.path, path)).cloned();

    let id = manifest
        .as_ref()
        .and_then(|m| m["id"].as_str().map(String::from))
        .or_else(|| old.as_ref().map(|e| e.id.clone()))
        .unwrap_or_else(|| gen_vault_id(path));
    let name = manifest
        .as_ref()
        .and_then(|m| m["name"].as_str().map(String::from))
        .or(fallback_name)
        .or_else(|| old.as_ref().map(|e| e.name.clone()))
        .or_else(|| {
            p.file_name()
                .and_then(|s| s.to_str())
                .map(String::from)
        })
        .unwrap_or_else(|| "笔记库".to_string());

    if manifest.is_none() {
        write_manifest(&p, &id, &name);
    }

    let now = unix_now();
    let entry = VaultEntry {
        id,
        name,
        path: path.to_string(),
        last_opened_at: now,
    };
    match reg.vaults.iter_mut().find(|v| same_path(&v.path, path)) {
        Some(e) => *e = entry.clone(),
        None => reg.vaults.push(entry.clone()),
    }
    write_registry(app, &reg)?;
    *state.vault.lock().unwrap() = Some(p);
    Ok(VaultInfo {
        exists: true,
        ..VaultInfo::from(&entry)
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            vault: Mutex::new(None),
        })
        .setup(|app| {
            if let Ok(cfg) = app.path().app_config_dir() {
                let reg_file = cfg.join("vaults.json");
                if !reg_file.exists() {
                    // 旧版单 vault 配置（vault.json 存一个路径）迁移为注册表首条
                    let old = cfg.join("vault.json");
                    if let Ok(txt) = fs::read_to_string(&old) {
                        if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                            if let Some(dir) = v["vault"].as_str() {
                                let p = PathBuf::from(dir);
                                if p.is_dir() {
                                    let mtime = fs::metadata(&old)
                                        .and_then(|m| m.modified())
                                        .ok()
                                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                        .map(|d| d.as_secs())
                                        .unwrap_or(0);
                                    let reg = VaultRegistryFile {
                                        version: 1,
                                        vaults: vec![VaultEntry {
                                            id: gen_vault_id(dir),
                                            name: p
                                                .file_name()
                                                .and_then(|s| s.to_str())
                                                .unwrap_or("笔记库")
                                                .to_string(),
                                            path: dir.to_string(),
                                            last_opened_at: mtime,
                                        }],
                                    };
                                    let _ = fs::create_dir_all(&cfg);
                                    let _ = fs::write(
                                        &reg_file,
                                        serde_json::to_vec_pretty(&reg).unwrap_or_default(),
                                    );
                                }
                            }
                        }
                    }
                }
                // 启动恢复：上次打开（lastOpenedAt 最新）且目录仍存在的仓库
                let reg = read_registry(app.handle());
                if let Some(v) = reg
                    .vaults
                    .iter()
                    .filter(|v| Path::new(&v.path).is_dir())
                    .max_by_key(|v| v.last_opened_at)
                {
                    let st = app.state::<AppState>();
                    *st.vault.lock().unwrap() = Some(PathBuf::from(&v.path));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_vaults, open_vault, create_vault, remove_vault, tree, read_note, write_note,
            create_note, create_folder, rename_path, move_path, delete_path, search, read_scene,
            save_scene, save_asset, import_file, read_asset, save_text_file, save_binary_file, create_canvas
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
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "excalidraw" | "canvas" | "mp4" | "webm" | "pdf")
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
fn list_vaults(app: AppHandle) -> Result<Value, String> {
    let reg = read_registry(&app);
    let vaults: Vec<VaultInfo> = reg.vaults.iter().map(VaultInfo::from).collect();
    let active = reg
        .vaults
        .iter()
        .max_by_key(|v| v.last_opened_at)
        .map(|v| v.path.clone());
    Ok(json!({ "vaults": vaults, "active": active }))
}

#[tauri::command]
fn open_vault(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<Value, String> {
    let info = upsert_and_activate(&app, &state, &path, None)?;
    Ok(serde_json::to_value(info).map_err(|e| e.to_string())?)
}

#[tauri::command]
fn create_vault(
    app: AppHandle,
    state: State<AppState>,
    parent: String,
    name: String,
) -> Result<Value, String> {
    let n = sanitize_name(&name, false);
    if n.is_empty() {
        return Err("仓库名称不能为空".into());
    }
    let parent_p = PathBuf::from(&parent);
    if !parent_p.is_dir() {
        return Err("位置不是有效文件夹".into());
    }
    // 父目录下已有同名文件夹时自动加序号（不覆盖用户数据）
    let dir = unique_abs(&parent_p.join(&n));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = to_posix(&dir);
    let id = gen_vault_id(&path);
    write_manifest(&dir, &id, &n);
    let info = upsert_and_activate(&app, &state, &path, Some(n))?;
    Ok(serde_json::to_value(info).map_err(|e| e.to_string())?)
}

/// 仅从注册表移除（列表里不再显示），绝不碰磁盘上的仓库文件夹
#[tauri::command]
fn remove_vault(app: AppHandle, path: String) -> Result<(), String> {
    let mut reg = read_registry(&app);
    reg.vaults.retain(|v| !same_path(&v.path, &path));
    write_registry(&app, &reg)
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
fn move_path(state: State<AppState>, from: String, to_folder: String) -> Result<String, String> {
    let v = vault_of(&state)?;
    let abs = resolve_inside(&v, &from)?;
    let dest_dir = if to_folder.is_empty() {
        v.clone()
    } else {
        resolve_inside(&v, &to_folder)?
    };
    if !dest_dir.is_dir() {
        return Err("目标不是文件夹".into());
    }
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let target = unique_abs(&dest_dir.join(abs.file_name().unwrap_or_default()));
    fs::rename(&abs, &target).map_err(|e| e.to_string())?;
    Ok(to_posix(&target.strip_prefix(&v).map_err(|e| e.to_string())?))
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
    // 空画板（新建）或引用的文件已被删：返回空场景，进入后重画会保存回原路径自愈
    let empty = r#"{"type":"excalidraw","version":2,"source":"noteshare","elements":[]}"#.to_string();
    match resolve_inside(&v, &path) {
        Ok(abs) => fs::read_to_string(&abs).or(Ok(empty)),
        Err(_) => Ok(empty),
    }
}

#[tauri::command]
fn save_scene(
    state: State<AppState>,
    name: Option<String>,
    scene_json: String,
    png_base64: Option<String>,
    folder: Option<String>,
) -> Result<Value, String> {
    let v = vault_of(&state)?;
    let dir = match &folder {
        Some(f) if !f.is_empty() => resolve_inside(&v, f)?,
        _ => v.join("attachments"),
    };
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

/// 新建空白白板（Obsidian 式 canvas，JSON 存 nodes/edges），返回 vault 相对路径。
/// folder 为空 = vault 根目录；name 可选（缺省 canvas-<时间戳>，自动补 .canvas 后缀）
#[tauri::command]
fn create_canvas(
    state: State<AppState>,
    folder: Option<String>,
    name: Option<String>,
) -> Result<String, String> {
    let v = vault_of(&state)?;
    let dir = match &folder {
        Some(f) if !f.is_empty() => resolve_inside(&v, f)?,
        _ => v.clone(),
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = chrono::Utc::now().timestamp();
    let file_name = match &name {
        Some(n) => {
            let mut s = sanitize_name(n, true);
            if s.is_empty() {
                s = format!("canvas-{stamp}");
            }
            if !s.to_lowercase().ends_with(".canvas") {
                s.push_str(".canvas");
            }
            s
        }
        None => format!("canvas-{stamp}.canvas"),
    };
    let abs = unique_abs(&dir.join(file_name));
    fs::write(&abs, r#"{"nodes":[],"edges":[]}"#).map_err(|e| e.to_string())?;
    Ok(to_posix(&abs.strip_prefix(&v).map_err(|e| e.to_string())?))
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

/// OS 拖放导入：落 vault 指定文件夹，保留原扩展名（白名单外的后缀也原样保留，
/// 只过滤危险字符），撞名自动加序号——与 save_asset 的"强转 png"语义不同。
#[tauri::command]
fn import_file(state: State<AppState>, folder: Option<String>, name: String, base64: String) -> Result<String, String> {
    let v = vault_of(&state)?;
    let dir = match folder.as_deref() {
        None | Some("") => v.clone(),
        Some(f) => resolve_inside(&v, f)?,
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem_raw = Path::new(&name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("导入文件");
    let mut stem = sanitize_name(stem_raw, true);
    if stem.is_empty() {
        stem = "导入文件".to_string();
    }
    let stem: String = stem.chars().take(80).collect();
    // 扩展名只放行字母数字（1-10 位），防路径注入；无扩展名就只写 stem
    let ext: String = Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(10)
        .collect();
    let file_name = if ext.is_empty() { stem } else { format!("{stem}.{ext}") };
    let abs = unique_abs(&dir.join(&file_name));
    let bytes = ::base64::engine::general_purpose::STANDARD
        .decode(&base64)
        .map_err(|e| e.to_string())?;
    fs::write(&abs, bytes).map_err(|e| e.to_string())?;
    Ok(to_posix(&abs.strip_prefix(&v).map_err(|e| e.to_string())?))
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

/// 下载图片等二进制：写入用户通过对话框选择的路径
#[tauri::command]
fn save_binary_file(target: String, base64: String) -> Result<(), String> {
    let bytes = ::base64::engine::general_purpose::STANDARD
        .decode(&base64)
        .map_err(|e| e.to_string())?;
    fs::write(&target, bytes).map_err(|e| e.to_string())
}
