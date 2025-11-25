mod commands;
mod db;
mod models;

use db::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let database =
                Database::new(app_data_dir).expect("Failed to initialize database");

            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_atoms,
            commands::get_atom,
            commands::create_atom,
            commands::update_atom,
            commands::delete_atom,
            commands::get_all_tags,
            commands::create_tag,
            commands::update_tag,
            commands::delete_tag,
            commands::get_atoms_by_tag,
            commands::check_sqlite_vec,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

