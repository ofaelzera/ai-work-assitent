mod commands;
mod server_config;
mod tray;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use server_config::AppState;

const TOGGLE_SHORTCUT: &str = "CmdOrCtrl+Shift+A";

pub fn run() {
    tauri::Builder::default()
        // single-instance DEVE ser o primeiro plugin (deep links no Windows/Linux
        // chegam como argv da segunda instância).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_focused().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                tray::show_main_window(app);
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::get_server_url,
            commands::connect_to_server,
            commands::reset_server,
            commands::set_unread_badge,
            commands::take_pending_deep_link,
            commands::save_download,
        ])
        .setup(|app| {
            app.manage(AppState::default());

            // Janela criada em Rust (não no config) para podermos restringir a
            // navegação à origem do servidor configurado.
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Aiwa")
                .inner_size(1280.0, 800.0)
                .min_inner_size(940.0, 600.0)
                .on_navigation(move |url| {
                    // Conteúdo local (bootstrap) sempre permitido.
                    if url.scheme() == "tauri"
                        || url.host_str() == Some("tauri.localhost")
                        || url.scheme() == "about"
                    {
                        return true;
                    }
                    let state = handle.state::<AppState>();
                    let allowed = state.allowed_origin.lock().unwrap().clone();
                    if let Some(allowed) = allowed {
                        if server_config::same_origin(url, &allowed) {
                            return true;
                        }
                    }
                    // Qualquer outro destino abre no navegador padrão.
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;

            tray::create_tray(app.handle())?;

            // Atalho global para mostrar/esconder a janela.
            let _ = app.global_shortcut().register(TOGGLE_SHORTCUT);

            // Em dev no Windows/Linux o esquema aiwa:// precisa ser registrado em runtime.
            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }

            // Deep links com o app aberto.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                if let Some(url) = event.urls().first() {
                    handle_deep_link(&handle, url);
                }
            });

            // Deep link de cold start (app aberto através de um link aiwa://).
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let Some(url) = urls.first() {
                    handle_deep_link(app.handle(), url);
                }
            }

            // Se já existe servidor configurado, navega direto para ele.
            if let Some(url) = server_config::load_server_url(app.handle()) {
                let _ = commands::navigate_to_server(app.handle(), url);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Fechar a janela esconde para a bandeja; sair só pelo menu do tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Aiwa Desktop")
        .run(|app, event| {
            // macOS: clicar no ícone do Dock reabre a janela escondida.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main_window(app);
            }
            let _ = (app, &event);
        });
}

/// Converte aiwa://inbox/123 em /inbox/123 e encaminha ao web app.
fn handle_deep_link(app: &tauri::AppHandle, url: &tauri::Url) {
    use tauri::Emitter;

    let host = url.host_str().unwrap_or("");
    let path = format!("/{}{}", host, url.path());

    let state = app.state::<AppState>();
    *state.pending_deep_link.lock().unwrap() = Some(path.clone());

    let _ = app.emit("deep-link-navigate", path);
    tray::show_main_window(app);
}
