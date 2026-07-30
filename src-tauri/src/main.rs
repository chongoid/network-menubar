// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;
use std::collections::HashMap;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager,
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

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
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
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
fn get_settings(_app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "scanInterval": 30000,
        "showOffline": true,
        "openAtLogin": false,
        "autoUpdateCheck": true
    })
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
            get_settings,
            update_setting,
            get_version,
            run_update
        ])
        .setup(|app| {
            let scan_item = MenuItem::with_id(app, "scan", "Scan Now", true, None::<&str>)?;
            let about_item = MenuItem::with_id(app, "about", "About", true, None::<&str>)?;
            let update_item = MenuItem::with_id(app, "update", "Check for Updates", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&scan_item, &about_item, &update_item, &quit_item])?;

            let icon_bytes = include_bytes!("../icons/32x32.png");
            let icon = Image::from_bytes(icon_bytes)?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("Network Menubar")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "scan" => {
                            use std::process::Command;
                            let _ = Command::new("osascript")
                                .arg("-e")
                                .arg(r#"display notification "Scanning local network..." with title "Network Menubar""#)
                                .status();
                        }
                        "about" => {
                            use std::process::Command;
                            let _ = Command::new("osascript")
                                .arg("-e")
                                .arg(r#"display dialog "Network Menubar v" & (do shell script "defaults read /Applications/Network\\ Menubar.app/Contents/Info CFBundleShortVersionString") & "\n\nShows machines on your local network in your menu bar." with title "About Network Menubar" buttons {"OK"} default button "OK""#)
                                .status();
                        }
                        "update" => {
                            use std::process::Command;
                            let _ = Command::new("bash")
                                .arg("-c")
                                .arg("curl -sL https://raw.githubusercontent.com/chongoid/network-menubar/main/install.sh -o /tmp/nm_install.sh && bash /tmp/nm_install.sh")
                                .spawn();
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|_tray, _event| {
                    // Left click shows menu by default (show_menu_on_left_click = true)
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}