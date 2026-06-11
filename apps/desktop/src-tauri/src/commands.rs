use std::time::Duration;

use tauri::{AppHandle, Manager, Url};

use crate::server_config::{self, AppState};

#[tauri::command]
pub fn get_server_url(app: AppHandle) -> Option<String> {
    server_config::load_server_url(&app).map(|u| u.to_string())
}

#[tauri::command]
pub async fn connect_to_server(app: AppHandle, url: String) -> Result<(), String> {
    let url = server_config::normalize_server_url(&url)?;

    // Ping: qualquer resposta HTTP significa servidor alcançável.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .danger_accept_invalid_certs(false)
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get(url.clone())
        .send()
        .await
        .map_err(|_| "Servidor inacessível. Verifique a URL e sua conexão.".to_string())?;

    server_config::save_server_url(&app, &url)?;
    navigate_to_server(&app, url)
}

#[tauri::command]
pub fn reset_server(app: AppHandle) -> Result<(), String> {
    server_config::clear_server_url(&app)?;
    server_config::set_allowed_origin(&app, None);
    navigate_to_bootstrap(&app)
}

#[tauri::command]
pub fn set_unread_badge(app: AppHandle, count: u32) {
    #[cfg(target_os = "macos")]
    if let Some(win) = app.get_webview_window("main") {
        let badge = if count > 0 { Some(count as i64) } else { None };
        let _ = win.set_badge_count(badge);
    }

    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = if count > 0 {
            format!("Aiwa — {count} não lida(s)")
        } else {
            "Aiwa".to_string()
        };
        let _ = tray.set_tooltip(Some(tooltip.as_str()));
        #[cfg(target_os = "macos")]
        {
            let title = if count > 0 { Some(count.to_string()) } else { None };
            let _ = tray.set_title(title.as_deref());
        }
    }
}

/// Consumido pelo web app ao montar, para deep links recebidos com o app fechado.
#[tauri::command]
pub fn take_pending_deep_link(app: AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let pending = state.pending_deep_link.lock().unwrap().take();
    pending
}

pub fn navigate_to_server(app: &AppHandle, url: Url) -> Result<(), String> {
    server_config::set_allowed_origin(app, Some(url.clone()));
    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada.".to_string())?;
    webview.navigate(url).map_err(|e| e.to_string())
}

pub fn navigate_to_bootstrap(app: &AppHandle) -> Result<(), String> {
    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| "Janela principal não encontrada.".to_string())?;
    #[cfg(target_os = "windows")]
    let url: Url = "http://tauri.localhost/index.html".parse().unwrap();
    #[cfg(not(target_os = "windows"))]
    let url: Url = "tauri://localhost/index.html".parse().unwrap();
    webview.navigate(url).map_err(|e| e.to_string())
}
