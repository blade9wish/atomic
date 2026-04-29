//! Atomic - A fast, lightweight key-value store server
//!
//! This is the main entry point for the atomic server application.
//! It handles command-line argument parsing, configuration loading,
//! and starting the HTTP server.

use std::net::SocketAddr;
use std::sync::Arc;

mod config;
mod db;
mod error;
mod handlers;
mod routes;

use config::Config;
use db::Database;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing/logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("atomic=debug".parse()?), // changed from info to debug for local dev
        )
        .init();

    // Load configuration from environment or defaults
    let config = Config::from_env();

    tracing::info!("Starting atomic server v{}", env!("CARGO_PKG_VERSION"));
    tracing::info!("Listening on {}:{}", config.host, config.port);

    // Initialize the database
    let db = Arc::new(Database::new(&config).await?);

    // Build the router
    let app = routes::build_router(db.clone());

    // Bind and serve
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("Invalid address");

    tracing::info!("Server ready at http://{}", addr);

    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("Server shutting down gracefully");
    Ok(())
}

/// Listens for OS shutdown signals (SIGINT, SIGTERM) for graceful shutdown.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).expect("Failed to register SIGTERM handler");
        let mut sigint = signal(SignalKind::interrupt()).expect("Failed to register SIGINT handler");

        tokio::select! {
            _ = sigterm.recv() => tracing::info!("Received SIGTERM"),
            _ = sigint.recv() => tracing::info!("Received SIGINT"),
        }
    }

    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to register Ctrl+C handler");
        tracing::info!("Received Ctrl+C");
    }
}
