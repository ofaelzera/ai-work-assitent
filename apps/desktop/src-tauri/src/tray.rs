use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

    let open_item = MenuItem::with_id(app, "open", "Abrir Aiwa", true, None::<&str>)?;
    let change_server =
        MenuItem::with_id(app, "change_server", "Trocar servidor…", true, None::<&str>)?;
    let check_updates = MenuItem::with_id(
        app,
        "check_updates",
        "Verificar atualizações…",
        true,
        None::<&str>,
    )?;
    let autostart_item = CheckMenuItem::with_id(
        app,
        "autostart",
        "Iniciar com o sistema",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &PredefinedMenuItem::separator(app)?,
            &change_server,
            &check_updates,
            &autostart_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Aiwa")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "change_server" => {
                show_main_window(app);
                let _ = crate::commands::reset_server(app.clone());
            }
            "check_updates" => check_for_updates(app.clone()),
            "autostart" => {
                let autolaunch = app.autolaunch();
                let enabled = autolaunch.is_enabled().unwrap_or(false);
                let result = if enabled {
                    autolaunch.disable()
                } else {
                    autolaunch.enable()
                };
                if result.is_err() {
                    log_dialog(app, "Não foi possível alterar a inicialização automática.");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn log_dialog(app: &AppHandle, message: &str) {
    app.dialog()
        .message(message)
        .kind(MessageDialogKind::Warning)
        .title("Aiwa")
        .show(|_| {});
}

pub fn check_for_updates(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_updater::UpdaterExt;

        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                notify_update_result(&app, &format!("Updater indisponível: {e}"));
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let app_for_dialog = app.clone();
                app.dialog()
                    .message(format!(
                        "Nova versão disponível: {version}. Instalar agora? O aplicativo será reiniciado."
                    ))
                    .title("Atualização do Aiwa")
                    .show(move |confirmed| {
                        if !confirmed {
                            return;
                        }
                        tauri::async_runtime::spawn(async move {
                            match update.download_and_install(|_, _| {}, || {}).await {
                                Ok(_) => app_for_dialog.restart(),
                                Err(e) => notify_update_result(
                                    &app_for_dialog,
                                    &format!("Falha ao instalar atualização: {e}"),
                                ),
                            }
                        });
                    });
            }
            Ok(None) => notify_update_result(&app, "Você já está na versão mais recente."),
            Err(e) => notify_update_result(&app, &format!("Falha ao verificar atualizações: {e}")),
        }
    });
}

fn notify_update_result(app: &AppHandle, message: &str) {
    app.dialog()
        .message(message)
        .kind(MessageDialogKind::Info)
        .title("Atualização do Aiwa")
        .show(|_| {});
}
