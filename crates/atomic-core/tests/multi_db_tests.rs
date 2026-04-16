//! Multi-database isolation tests.
//!
//! CLAUDE.md flags this as the area most prone to silent cross-contamination
//! bugs: per-DB data must not leak, and `AtomicCore::{get_settings, set_setting}`
//! intentionally routes to the shared registry when one is attached (so it is
//! *global*, not per-DB). Anything that needs per-DB state — scheduler
//! last-run timestamps, per-DB feature flags — must bypass that routing.
//!
//! These tests open a real `DatabaseManager`, create two data databases
//! inside it, and assert:
//!
//!   1. Atoms created in DB1 are invisible from DB2 (and vice versa).
//!   2. Tags are isolated per-database.
//!   3. `set_setting` is *intentionally global* when a registry is attached —
//!      this test pins that contract so anyone refactoring settings routing
//!      sees the consequence and remembers to route per-DB state elsewhere.
//!
//! Runs against both SQLite (via `Registry` + per-file data DBs) and Postgres
//! (single shared pool, rows keyed by `db_id`).

mod support;

use std::collections::HashSet;

use atomic_core::{CreateAtomRequest, DatabaseManager};
use tempfile::TempDir;

#[tokio::test]
async fn isolation_sqlite() {
    let dir = TempDir::new().expect("tempdir");
    let manager = DatabaseManager::new(dir.path()).expect("open manager");
    run_isolation(&manager).await;
}

#[cfg(feature = "postgres")]
#[tokio::test]
async fn isolation_postgres() {
    let Ok(url) = std::env::var("ATOMIC_TEST_DATABASE_URL") else {
        eprintln!("isolation_postgres: skipping (ATOMIC_TEST_DATABASE_URL not set)");
        return;
    };
    // Shared Postgres deployment — start clean so leftover rows from earlier
    // suites don't make "DB2 sees DB1's data" look like a leak when it's
    // actually prior test residue.
    support::truncate_postgres_for_test(&url).await;
    let dir = TempDir::new().expect("tempdir");
    let manager = DatabaseManager::new_postgres(dir.path(), &url)
        .await
        .expect("open postgres manager");
    run_isolation(&manager).await;
}

async fn run_isolation(manager: &DatabaseManager) {
    // Create two named databases. Using explicit names (rather than the
    // seeded default) means the test is robust against reordering and
    // survives in a shared Postgres where another suite may have created
    // different defaults earlier.
    let db1 = manager
        .create_database("isolation_alpha")
        .await
        .expect("create db alpha");
    let db2 = manager
        .create_database("isolation_beta")
        .await
        .expect("create db beta");
    assert_ne!(db1.id, db2.id, "two databases must have distinct ids");

    let core1 = manager.get_core(&db1.id).await.expect("get_core alpha");
    let core2 = manager.get_core(&db2.id).await.expect("get_core beta");

    // ---------- Atom isolation ----------
    let a1 = core1
        .create_atom(
            CreateAtomRequest {
                content: "alpha-only content".to_string(),
                ..Default::default()
            },
            |_| {},
        )
        .await
        .expect("create_atom alpha")
        .expect("alpha atom inserted");
    let a2 = core2
        .create_atom(
            CreateAtomRequest {
                content: "beta-only content".to_string(),
                ..Default::default()
            },
            |_| {},
        )
        .await
        .expect("create_atom beta")
        .expect("beta atom inserted");

    assert!(
        core1.get_atom(&a1.atom.id).await.unwrap().is_some(),
        "alpha should see its own atom"
    );
    assert!(
        core1.get_atom(&a2.atom.id).await.unwrap().is_none(),
        "alpha MUST NOT see beta's atom (leak!)"
    );
    assert!(
        core2.get_atom(&a2.atom.id).await.unwrap().is_some(),
        "beta should see its own atom"
    );
    assert!(
        core2.get_atom(&a1.atom.id).await.unwrap().is_none(),
        "beta MUST NOT see alpha's atom (leak!)"
    );

    // ---------- Tag isolation ----------
    core1
        .create_tag("AlphaOnlyTag", None)
        .await
        .expect("create tag in alpha");
    core2
        .create_tag("BetaOnlyTag", None)
        .await
        .expect("create tag in beta");

    let names1: HashSet<String> = core1
        .get_all_tags()
        .await
        .unwrap()
        .into_iter()
        .map(|t| t.tag.name)
        .collect();
    let names2: HashSet<String> = core2
        .get_all_tags()
        .await
        .unwrap()
        .into_iter()
        .map(|t| t.tag.name)
        .collect();

    assert!(
        names1.contains("AlphaOnlyTag"),
        "alpha should see its own tag; got {:?}",
        names1
    );
    assert!(
        !names1.contains("BetaOnlyTag"),
        "alpha MUST NOT see beta's tag; got {:?}",
        names1
    );
    assert!(
        names2.contains("BetaOnlyTag"),
        "beta should see its own tag; got {:?}",
        names2
    );
    assert!(
        !names2.contains("AlphaOnlyTag"),
        "beta MUST NOT see alpha's tag; got {:?}",
        names2
    );

    // ---------- The registry footgun ----------
    //
    // `AtomicCore::set_setting` routes through the registry when attached
    // (SQLite DatabaseManager always has one; Postgres DatabaseManager has
    // none but `AtomicCore` still stores settings at the db-id scope). The
    // important invariant is the *documented* behavior: settings written
    // via `set_setting` are visible from both cores. If a future refactor
    // quietly swaps this to per-DB routing, this assertion fires — giving
    // the author a chance to go audit the scheduler and anywhere else that
    // relies on the current shape.
    core1
        .set_setting("provider", "ollama")
        .await
        .expect("set_setting on alpha");
    let s2 = core2.get_settings().await.expect("get_settings on beta");
    assert_eq!(
        s2.get("provider").map(String::as_str),
        Some("ollama"),
        "set_setting/get_settings share state across DBs (registry when SQLite, \
         per-db_id rows in Postgres). Per-DB state MUST use a different mechanism — \
         see crates/atomic-core/src/scheduler/state.rs for the canonical pattern."
    );
}
