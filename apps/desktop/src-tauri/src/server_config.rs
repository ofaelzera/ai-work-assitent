use std::sync::Mutex;

use tauri::{AppHandle, Manager, Url};
use tauri_plugin_store::StoreExt;

pub const STORE_FILE: &str = "store.json";
pub const SERVER_URL_KEY: &str = "serverUrl";

/// Estado compartilhado: origem permitida para navegação + deep link pendente
/// recebido antes do web app terminar de carregar.
#[derive(Default)]
pub struct AppState {
    pub allowed_origin: Mutex<Option<Url>>,
    pub pending_deep_link: Mutex<Option<String>>,
}

pub fn load_server_url(app: &AppHandle) -> Option<Url> {
    let store = app.store(STORE_FILE).ok()?;
    let value = store.get(SERVER_URL_KEY)?;
    let url = value.as_str()?.parse::<Url>().ok()?;
    Some(url)
}

pub fn save_server_url(app: &AppHandle, url: &Url) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(SERVER_URL_KEY, serde_json::json!(url.as_str()));
    store.save().map_err(|e| e.to_string())
}

pub fn clear_server_url(app: &AppHandle) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.delete(SERVER_URL_KEY);
    store.save().map_err(|e| e.to_string())
}

pub fn set_allowed_origin(app: &AppHandle, url: Option<Url>) {
    let state = app.state::<AppState>();
    *state.allowed_origin.lock().unwrap() = url;
}

fn is_local_host(host: &str) -> bool {
    host == "localhost"
        || host == "127.0.0.1"
        || host.starts_with("192.168.")
        || host.starts_with("10.")
        || host.ends_with(".local")
}

/// Normaliza e valida a URL informada pelo usuário.
/// HTTPS obrigatório, exceto para hosts locais (desenvolvimento/self-hosted em LAN).
pub fn normalize_server_url(raw: &str) -> Result<Url, String> {
    let raw = raw.trim().trim_end_matches('/');
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let url: Url = with_scheme
        .parse()
        .map_err(|_| "URL inválida. Exemplo: https://app.suaempresa.com".to_string())?;

    let host = url
        .host_str()
        .ok_or_else(|| "URL sem host válido.".to_string())?
        .to_string();

    match url.scheme() {
        "https" => {}
        "http" if is_local_host(&host) => {}
        "http" => {
            return Err("Por segurança, use HTTPS. HTTP é permitido apenas para servidores locais (localhost / rede privada).".to_string())
        }
        other => return Err(format!("Esquema não suportado: {other}://")),
    }

    Ok(url)
}

/// Verifica se uma URL de navegação pertence à origem permitida.
pub fn same_origin(url: &Url, allowed: &Url) -> bool {
    url.scheme() == allowed.scheme()
        && url.host_str() == allowed.host_str()
        && url.port_or_known_default() == allowed.port_or_known_default()
}
