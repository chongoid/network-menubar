// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Machine {
    pub ip: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub online: bool,
    pub last_seen: u64,
    #[serde(rename = "type")]
    pub machine_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_time: Option<u128>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannerState {
    pub machines: HashMap<String, Machine>,
    pub local_ip: String,
    pub subnet: String,
    pub scan_version: u64,
    pub first_scan: bool,
    pub dns_attempted: Vec<String>,
}

impl Default for ScannerState {
    fn default() -> Self {
        Self {
            machines: HashMap::new(),
            local_ip: "127.0.0.1".to_string(),
            subnet: "192.168.1".to_string(),
            scan_version: 0,
            first_scan: true,
            dns_attempted: Vec::new(),
        }
    }
}

type SharedState = Arc<Mutex<ScannerState>>;

#[tauri::command]
fn get_machines(state: tauri::State<'_, SharedState>) -> Vec<Machine> {
    let s = state.lock();
    s.machines.values().cloned().collect()
}

#[tauri::command]
fn scan(state: tauri::State<'_, SharedState>) -> bool {
    let mut s = state.lock();
    s.scan_version += 1;
    true
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let _ = Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                if let Some(stdin) = &mut child.stdin {
                    use std::io::Write;
                    let _ = stdin.write_all(text.as_bytes());
                }
                child.wait()
            });
    }
    true
}

#[tauri::command]
fn open_ssh(host: String) -> bool {
    use std::process::Command;
    let _ = Command::new("open").arg(format!("ssh://{}", host)).status();
    true
}

#[tauri::command]
fn show_dashboard(app: AppHandle) -> bool {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    true
}

#[tauri::command]
fn hide_dashboard(app: AppHandle) -> bool {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    true
}

#[tauri::command]
fn close_welcome(app: AppHandle, dont_show_again: bool) -> bool {
    if dont_show_again {
        if let Ok(path) = app.path().config_dir() {
            let welcomed_path = path.join(".network-menubar-welcomed");
            let _ = std::fs::write(
                welcomed_path,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis()
                    .to_string(),
            );
        }
    }
    if let Some(window) = app.get_webview_window("welcome") {
        let _ = window.close();
    }
    true
}

#[tauri::command]
fn get_settings(app: AppHandle) -> serde_json::Value {
    let mut settings = serde_json::json!({
        "scanInterval": 30000,
        "showOffline": true,
        "openAtLogin": false,
        "autoUpdateCheck": true
    });

    if let Ok(path) = app.path().config_dir() {
        let settings_path = path.join("network-menubar-settings.json");
        if let Ok(data) = std::fs::read_to_string(&settings_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&data) {
                settings = parsed;
            }
        }
    }

    settings
}

#[tauri::command]
fn update_setting(app: AppHandle, key: String, value: serde_json::Value) -> bool {
    if let Ok(path) = app.path().config_dir() {
        let settings_path = path.join("network-menubar-settings.json");
        let mut settings = get_settings(app);
        settings[key] = value;
        let _ = std::fs::write(
            &settings_path,
            serde_json::to_string_pretty(&settings).unwrap_or_default(),
        );
    }
    true
}

#[tauri::command]
fn check_updates(_app: AppHandle) -> bool {
    true
}

#[tauri::command]
fn get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn run_update() -> bool {
    use std::process::Command;
    let _ = Command::new("bash")
        .arg("-c")
        .arg("curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh")
        .status();
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(ScannerState::default())))
        .invoke_handler(tauri::generate_handler![
            get_machines,
            scan,
            copy_to_clipboard,
            open_ssh,
            show_dashboard,
            hide_dashboard,
            close_welcome,
            get_settings,
            update_setting,
            check_updates,
            get_version,
            run_update
        ])
        .setup(|app| {
            let config_dir = app.path().config_dir().unwrap_or_default();
            let welcomed_path = config_dir.join(".network-menubar-welcomed");
            if !welcomed_path.exists() {
                if let Some(welcome) = app.get_webview_window("welcome") {
                    let _ = welcome.show();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
