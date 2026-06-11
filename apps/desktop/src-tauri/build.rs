fn main() {
    // Declarar os comandos gera as permissões allow-*/deny- no ACL.
    // Sem isso, origens REMOTAS (o web app) são sempre bloqueadas pelo IPC.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "get_server_url",
            "connect_to_server",
            "reset_server",
            "set_unread_badge",
            "take_pending_deep_link",
        ])),
    )
    .expect("failed to run tauri-build");
}
