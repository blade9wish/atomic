use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tracing;

const SIDECAR_PORT: u16 = 44380;
const HEALTH_POLL_INTERVAL_MS: u64 = 100;
const HEALTH_TIMEOUT_MS: u64 = 10_000;

/// Config returned to the frontend so it can connect to the sidecar
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalServerConfig {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "authToken")]
    pub auth_token: String,
}

/// Holds the sidecar child process for cleanup on exit
struct SidecarChild(tauri_plugin_shell::process::CommandChild);

struct SidecarState {
    child: Mutex<Option<SidecarChild>>,
}

#[tauri::command]
fn get_local_server_config(
    config: tauri::State<'_, LocalServerConfig>,
) -> LocalServerConfig {
    config.inner().clone()
}

/// Read or create the local server auth token.
/// Uses the registry (shared across databases) for token management.
fn ensure_local_token(app_data_dir: &std::path::Path) -> String {
    let token_file = app_data_dir.join("local_server_token");

    // Try to read existing token
    if let Ok(token) = std::fs::read_to_string(&token_file) {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return token;
        }
    }

    // Create a new token via the DatabaseManager (opens registry + default db)
    let manager = atomic_core::DatabaseManager::new(app_data_dir)
        .expect("Failed to open database manager for token bootstrap");

    let (_info, raw_token) = manager
        .registry()
        .create_api_token("desktop")
        .expect("Failed to create API token");

    std::fs::write(&token_file, &raw_token)
        .expect("Failed to write local server token file");

    raw_token
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "atomic_lib=info,atomic_core=info,warn".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data directory");

            tracing::info!(path = ?app_data_dir, "Data directory");

            // Bootstrap auth token (opens registry/manager)
            let auth_token = ensure_local_token(&app_data_dir);

            let base_url = format!("http://127.0.0.1:{}", SIDECAR_PORT);
            let config = LocalServerConfig {
                base_url: base_url.clone(),
                auth_token: auth_token.clone(),
            };
            app.manage(config.clone());

            // Check if an Atomic server is already running on the port
            let health_url = format!("{}/health", base_url);
            let already_running = reqwest::blocking::Client::new()
                .get(&health_url)
                .timeout(std::time::Duration::from_millis(500))
                .send()
                .is_ok_and(|r| r.status().is_success());

            if already_running {
                tracing::info!(url = %base_url, "Atomic server already running, reusing it");
                app.manage(SidecarState {
                    child: Mutex::new(None),
                });
            } else {
                // Spawn atomic-server as a sidecar
                let shell = app.shell();
                let sidecar_cmd = shell
                    .sidecar("atomic-server")
                    .expect("Failed to create sidecar command")
                    .args([
                        "--data-dir",
                        app_data_dir.to_str().unwrap(),
                        "serve",
                        "--port",
                        &SIDECAR_PORT.to_string(),
                    ]);

                let (mut rx, child) =
                    sidecar_cmd.spawn().expect("Failed to spawn atomic-server sidecar");

                // Log sidecar output
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_shell::process::CommandEvent;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                tracing::debug!(output = %String::from_utf8_lossy(&line), "sidecar stdout");
                            }
                            CommandEvent::Stderr(line) => {
                                tracing::debug!(output = %String::from_utf8_lossy(&line), "sidecar stderr");
                            }
                            CommandEvent::Terminated(payload) => {
                                tracing::info!(?payload, "sidecar terminated");
                                break;
                            }
                            CommandEvent::Error(err) => {
                                tracing::debug!(error = %err, "sidecar error");
                            }
                            _ => {}
                        }
                    }
                });

                app.manage(SidecarState {
                    child: Mutex::new(Some(SidecarChild(child))),
                });

                // Poll health endpoint until ready
                let start = std::time::Instant::now();
                loop {
                    if start.elapsed().as_millis() as u64 > HEALTH_TIMEOUT_MS {
                        tracing::warn!(timeout_ms = HEALTH_TIMEOUT_MS, "Sidecar health check timed out");
                        break;
                    }
                    match reqwest::blocking::Client::new()
                        .get(&health_url)
                        .timeout(std::time::Duration::from_millis(500))
                        .send()
                    {
                        Ok(resp) if resp.status().is_success() => {
                            tracing::debug!(url = %base_url, elapsed_ms = start.elapsed().as_millis(), "Sidecar ready");
                            break;
                        }
                        _ => {
                            std::thread::sleep(std::time::Duration::from_millis(HEALTH_POLL_INTERVAL_MS));
                        }
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_local_server_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Kill sidecar on app exit
                if let Some(state) = app.try_state::<SidecarState>() {
                    if let Ok(mut child_opt) = state.child.lock() {
                        if let Some(SidecarChild(child)) = child_opt.take() {
                            tracing::info!("Shutting down sidecar");
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
