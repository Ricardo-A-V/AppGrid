#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

fn default_span() -> u8 { 1 }
fn default_string() -> String { String::new() }

#[derive(Serialize, Deserialize, Clone)]
struct AppTile {
    id: String,
    label: String,
    icon_url: String,
    target: String,
    is_url: bool,
    index: usize,
    #[serde(default = "default_span")]
    col_span: u8,
    #[serde(default = "default_span")]
    row_span: u8,
    #[serde(default = "default_string")]
    bg_style: String,
    #[serde(default = "default_string")]
    tile_type: String,
}

#[derive(Serialize)]
struct ShortcutData {
    name: String,
    path: String,
}

fn get_app_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_data_dir)
}

#[tauri::command]
fn save_config(state: Vec<AppTile>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_app_dir(&app_handle)?.join("grid_layout.json");
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    let mut file = File::create(config_path).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_config(app_handle: tauri::AppHandle) -> Result<Vec<AppTile>, String> {
    let config_path = get_app_dir(&app_handle)?.join("grid_layout.json");
    if !config_path.exists() { return Ok(Vec::new()); }
    let mut file = File::open(config_path).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|e| e.to_string())?;
    let state: Vec<AppTile> = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    Ok(state)
}

// NUEVO: Comandos para guardar y cargar el fondo global
#[tauri::command]
fn save_bg(bg: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_app_dir(&app_handle)?.join("bg_config.txt");
    let mut file = File::create(config_path).map_err(|e| e.to_string())?;
    file.write_all(bg.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_bg(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config_path = get_app_dir(&app_handle)?.join("bg_config.txt");
    if !config_path.exists() { return Ok(String::new()); }
    let mut file = File::open(config_path).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|e| e.to_string())?;
    Ok(contents)
}

#[tauri::command]
fn open_shortcuts_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = get_app_dir(&app_handle)?.join("shortcuts");
    if !dir.exists() { fs::create_dir_all(&dir).map_err(|e| e.to_string())?; }
    Command::new("explorer").args([dir.to_str().unwrap()]).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_shortcuts(app_handle: tauri::AppHandle) -> Result<Vec<ShortcutData>, String> {
    let dir = get_app_dir(&app_handle)?.join("shortcuts");
    if !dir.exists() { fs::create_dir_all(&dir).map_err(|e| e.to_string())?; return Ok(Vec::new()); }
    let mut shortcuts = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext == "lnk" || ext == "exe" || ext == "url" {
                        shortcuts.push(ShortcutData {
                            name: path.file_stem().unwrap().to_string_lossy().into_owned(),
                            path: path.to_string_lossy().into_owned(),
                        });
                    }
                }
            }
        }
    }
    Ok(shortcuts)
}

#[tauri::command]
fn extract_icon(path: &str) -> Result<String, String> {
    let ps_script = format!(
        r#"
        try {{
            Add-Type -AssemblyName System.Drawing
            $absPath = (Resolve-Path '{}' -ErrorAction Stop).Path
            $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($absPath)
            $ms = New-Object System.IO.MemoryStream
            $icon.ToBitmap().Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            [Convert]::ToBase64String($ms.ToArray())
        }} catch {{
            Write-Output "ERROR"
        }}
        "#,
        path.replace("'", "''")
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps_script])
        .output().map_err(|e| e.to_string())?;
    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
    
    if result == "ERROR" || result.is_empty() { Err("Error".into()) } else { Ok(format!("data:image/png;base64,{}", result)) }
}

#[tauri::command]
fn launch_app(target: &str) -> Result<(), String> {
    let result = Command::new("cmd").args(["/C", "start", "", target]).spawn();
    match result { Ok(_) => Ok(()), Err(e) => Err(e.to_string()), }
}

#[tauri::command]
fn close_app() { std::process::exit(0); }

#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) {
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!is_fullscreen);
}

#[tauri::command]
fn start_drag(window: tauri::Window) {
    // Delega el cálculo de movimiento directamente al gestor de ventanas del sistema operativo
    let _ = window.start_dragging();
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            launch_app, close_app, toggle_fullscreen,
            save_config, load_config, save_bg, load_bg, get_shortcuts, open_shortcuts_folder,
            extract_icon, start_drag
        ])
        .run(tauri::generate_context!())
        .expect("Error initializing Tauri");
}