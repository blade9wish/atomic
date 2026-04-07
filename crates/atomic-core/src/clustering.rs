//! Atom clustering for visualization
//!
//! This module handles grouping atoms into clusters based on semantic similarity.

use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

use crate::models::{AtomCluster, ClusterAlgorithm};

/// Dispatch to the selected clustering algorithm.
/// All algorithms take the same weighted edge list and return node → cluster label.
pub fn run_algorithm(
    algorithm: ClusterAlgorithm,
    edges: &[(String, String, f32)],
) -> HashMap<String, u32> {
    match algorithm {
        ClusterAlgorithm::LabelPropagation => label_propagation(edges),
        ClusterAlgorithm::Louvain => louvain(edges),
        ClusterAlgorithm::Leiden => leiden(edges),
    }
}

/// Run label propagation on an arbitrary weighted adjacency list.
/// Returns a map from node ID to cluster label (u32).
/// Nodes in the same cluster share the same label.
pub fn label_propagation(
    edges: &[(String, String, f32)],
) -> HashMap<String, u32> {
    if edges.is_empty() {
        return HashMap::new();
    }

    // Build adjacency list
    let mut adjacency: HashMap<String, Vec<(String, f32)>> = HashMap::new();
    let mut all_nodes: HashSet<String> = HashSet::new();

    for (source, target, score) in edges {
        adjacency
            .entry(source.clone())
            .or_default()
            .push((target.clone(), *score));
        adjacency
            .entry(target.clone())
            .or_default()
            .push((source.clone(), *score));
        all_nodes.insert(source.clone());
        all_nodes.insert(target.clone());
    }

    // Sort nodes for deterministic iteration order
    let mut sorted_nodes: Vec<String> = all_nodes.into_iter().collect();
    sorted_nodes.sort();

    // Initialize each node with its own cluster label
    let mut labels: HashMap<String, u32> = HashMap::new();
    for (i, node) in sorted_nodes.iter().enumerate() {
        labels.insert(node.clone(), i as u32);
    }

    // Label propagation: iterate until convergence or max iterations
    let max_iterations = 20;
    for _ in 0..max_iterations {
        let mut changed = false;

        for node in sorted_nodes.iter() {
            if let Some(neighbors) = adjacency.get(node) {
                let mut label_scores: HashMap<u32, f32> = HashMap::new();

                for (neighbor, weight) in neighbors {
                    if let Some(&neighbor_label) = labels.get(neighbor) {
                        *label_scores.entry(neighbor_label).or_default() += weight;
                    }
                }

                if let Some((&best_label, _)) = label_scores
                    .iter()
                    .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                {
                    let current_label = *labels.get(node).unwrap();
                    if best_label != current_label {
                        labels.insert(node.clone(), best_label);
                        changed = true;
                    }
                }
            }
        }

        if !changed {
            break;
        }
    }

    labels
}

/// Run Louvain modularity optimization on a weighted adjacency list.
/// Phase 1: Greedily move nodes to neighbor communities to maximize modularity.
/// Phase 2: Collapse communities into super-nodes; repeat until no improvement.
pub fn louvain(edges: &[(String, String, f32)]) -> HashMap<String, u32> {
    if edges.is_empty() {
        return HashMap::new();
    }

    // Build adjacency and compute total weight
    let mut adjacency: HashMap<String, Vec<(String, f32)>> = HashMap::new();
    let mut all_nodes: HashSet<String> = HashSet::new();
    let mut total_weight: f64 = 0.0;

    for (source, target, weight) in edges {
        let w = *weight;
        adjacency
            .entry(source.clone())
            .or_default()
            .push((target.clone(), w));
        adjacency
            .entry(target.clone())
            .or_default()
            .push((source.clone(), w));
        all_nodes.insert(source.clone());
        all_nodes.insert(target.clone());
        total_weight += w as f64;
    }

    // total_weight = sum of all edge weights (each edge counted once above)
    // In modularity formula, m = total_weight, and we use 2m for normalization
    let two_m = 2.0 * total_weight;
    if two_m == 0.0 {
        return HashMap::new();
    }

    let mut sorted_nodes: Vec<String> = all_nodes.into_iter().collect();
    sorted_nodes.sort();

    // Initialize: each node in its own community
    let mut community: HashMap<String, u32> = HashMap::new();
    for (i, node) in sorted_nodes.iter().enumerate() {
        community.insert(node.clone(), i as u32);
    }

    // k_i = sum of weights of all edges incident to node i
    let mut k: HashMap<String, f64> = HashMap::new();
    for node in &sorted_nodes {
        let ki: f64 = adjacency
            .get(node)
            .map(|neighbors| neighbors.iter().map(|(_, w)| *w as f64).sum())
            .unwrap_or(0.0);
        k.insert(node.clone(), ki);
    }

    // Phase 1: Local moves
    let max_passes = 20;
    for _ in 0..max_passes {
        let mut improved = false;

        // Compute sum_tot: total incident weight per community
        let mut sum_tot: HashMap<u32, f64> = HashMap::new();
        for node in &sorted_nodes {
            let c = community[node];
            *sum_tot.entry(c).or_default() += k[node];
        }

        for node in &sorted_nodes {
            let ki = k[node];
            let current_comm = community[node];

            // Compute k_i_in for each neighboring community
            let mut neighbor_comm_weights: HashMap<u32, f64> = HashMap::new();
            if let Some(neighbors) = adjacency.get(node) {
                for (neighbor, w) in neighbors {
                    let nc = community[neighbor];
                    *neighbor_comm_weights.entry(nc).or_default() += *w as f64;
                }
            }

            // Delta Q for removing node from its current community
            // Standard formula uses (sum_tot[C] - k_i) to exclude node i's own contribution
            let ki_in_current = neighbor_comm_weights.get(&current_comm).copied().unwrap_or(0.0);
            let st_current = sum_tot.get(&current_comm).copied().unwrap_or(0.0);
            let remove_cost = ki_in_current / two_m - ((st_current - ki) * ki) / (two_m * two_m);

            // Find best community to move to
            let mut best_comm = current_comm;
            let mut best_gain = 0.0;

            for (&target_comm, &ki_in_target) in &neighbor_comm_weights {
                if target_comm == current_comm {
                    continue;
                }
                let st_target = sum_tot.get(&target_comm).copied().unwrap_or(0.0);
                let gain = ki_in_target / two_m - (st_target * ki) / (two_m * two_m) - remove_cost;
                if gain > best_gain {
                    best_gain = gain;
                    best_comm = target_comm;
                }
            }

            if best_comm != current_comm {
                // Update sum_tot aggregates
                *sum_tot.entry(current_comm).or_default() -= ki;
                *sum_tot.entry(best_comm).or_default() += ki;

                community.insert(node.clone(), best_comm);
                improved = true;
            }
        }

        if !improved {
            break;
        }
    }

    // Normalize labels to 0..N
    let mut label_map: HashMap<u32, u32> = HashMap::new();
    let mut next_label = 0u32;
    let mut result: HashMap<String, u32> = HashMap::new();
    for node in &sorted_nodes {
        let c = community[node];
        let label = *label_map.entry(c).or_insert_with(|| {
            let l = next_label;
            next_label += 1;
            l
        });
        result.insert(node.clone(), label);
    }

    result
}

/// Louvain-based community detection with intra-community refinement.
///
/// Extends the Louvain algorithm with a refinement phase: after the initial
/// local-move pass, each community is re-partitioned from singletons using
/// modularity-guided local moves restricted to that community. This encourages
/// internally well-connected communities, inspired by (but not identical to)
/// the Leiden algorithm of Traag et al. 2019 — the published Leiden uses
/// randomised CPM-gated merging whereas this variant uses deterministic
/// modularity-based local moves for the refinement step.
pub fn leiden(edges: &[(String, String, f32)]) -> HashMap<String, u32> {
    if edges.is_empty() {
        return HashMap::new();
    }

    // Build adjacency
    let mut adjacency: HashMap<String, Vec<(String, f32)>> = HashMap::new();
    let mut all_nodes: HashSet<String> = HashSet::new();
    let mut total_weight: f64 = 0.0;

    for (source, target, weight) in edges {
        let w = *weight;
        adjacency
            .entry(source.clone())
            .or_default()
            .push((target.clone(), w));
        adjacency
            .entry(target.clone())
            .or_default()
            .push((source.clone(), w));
        all_nodes.insert(source.clone());
        all_nodes.insert(target.clone());
        total_weight += w as f64;
    }

    let two_m = 2.0 * total_weight;
    if two_m == 0.0 {
        return HashMap::new();
    }

    let mut sorted_nodes: Vec<String> = all_nodes.into_iter().collect();
    sorted_nodes.sort();

    // k_i = sum of weights of all edges incident to node i
    let mut k: HashMap<String, f64> = HashMap::new();
    for node in &sorted_nodes {
        let ki: f64 = adjacency
            .get(node)
            .map(|neighbors| neighbors.iter().map(|(_, w)| *w as f64).sum())
            .unwrap_or(0.0);
        k.insert(node.clone(), ki);
    }

    // Initialize: each node in its own community
    let mut community: HashMap<String, u32> = HashMap::new();
    for (i, node) in sorted_nodes.iter().enumerate() {
        community.insert(node.clone(), i as u32);
    }

    let max_iterations = 10;
    for _ in 0..max_iterations {
        // --- Phase 1: Local moving (same as Louvain) ---
        let mut phase1_community = community.clone();
        let mut moved = false;

        for _ in 0..20 {
            let mut pass_moved = false;

            let mut sum_tot: HashMap<u32, f64> = HashMap::new();
            for node in &sorted_nodes {
                let c = phase1_community[node];
                *sum_tot.entry(c).or_default() += k[node];
            }

            for node in &sorted_nodes {
                let ki = k[node];
                let current_comm = phase1_community[node];

                let mut neighbor_comm_weights: HashMap<u32, f64> = HashMap::new();
                if let Some(neighbors) = adjacency.get(node) {
                    for (neighbor, w) in neighbors {
                        let nc = phase1_community[neighbor];
                        *neighbor_comm_weights.entry(nc).or_default() += *w as f64;
                    }
                }

                let ki_in_current =
                    neighbor_comm_weights.get(&current_comm).copied().unwrap_or(0.0);
                let st_current = sum_tot.get(&current_comm).copied().unwrap_or(0.0);
                let remove_cost =
                    ki_in_current / two_m - ((st_current - ki) * ki) / (two_m * two_m);

                let mut best_comm = current_comm;
                let mut best_gain = 0.0;

                for (&target_comm, &ki_in_target) in &neighbor_comm_weights {
                    if target_comm == current_comm {
                        continue;
                    }
                    let st_target = sum_tot.get(&target_comm).copied().unwrap_or(0.0);
                    let gain =
                        ki_in_target / two_m - (st_target * ki) / (two_m * two_m) - remove_cost;
                    if gain > best_gain {
                        best_gain = gain;
                        best_comm = target_comm;
                    }
                }

                if best_comm != current_comm {
                    *sum_tot.entry(current_comm).or_default() -= ki;
                    *sum_tot.entry(best_comm).or_default() += ki;
                    phase1_community.insert(node.clone(), best_comm);
                    pass_moved = true;
                    moved = true;
                }
            }

            if !pass_moved {
                break;
            }
        }

        if !moved {
            break;
        }

        // --- Phase 2: Refinement ---
        // Within each phase-1 community, re-partition nodes using local moves
        // restricted to subcommunities of that community. This ensures communities
        // are internally well-connected.
        let mut refined_community: HashMap<String, u32> = HashMap::new();
        let mut next_refined_label = 0u32;

        // Group nodes by phase-1 community
        let mut comm_members: HashMap<u32, Vec<String>> = HashMap::new();
        for node in &sorted_nodes {
            comm_members
                .entry(phase1_community[node])
                .or_default()
                .push(node.clone());
        }

        for (_comm_id, members) in &comm_members {
            if members.len() <= 1 {
                // Singleton — keep as-is
                for node in members {
                    refined_community.insert(node.clone(), next_refined_label);
                }
                next_refined_label += 1;
                continue;
            }

            // Start each node in its own sub-community within this phase-1 community
            let member_set: HashSet<&String> = members.iter().collect();
            let mut sub_comm: HashMap<String, u32> = HashMap::new();
            let mut sub_label = next_refined_label;
            for node in members {
                sub_comm.insert(node.clone(), sub_label);
                sub_label += 1;
            }

            // Local moves within this community only
            for _ in 0..10 {
                let mut sub_moved = false;

                let mut sub_sum_tot: HashMap<u32, f64> = HashMap::new();
                for node in members {
                    let c = sub_comm[node];
                    *sub_sum_tot.entry(c).or_default() += k[node];
                }

                for node in members {
                    let ki = k[node];
                    let current_sub = sub_comm[node];

                    // Only consider neighbors within this community
                    let mut neighbor_sub_weights: HashMap<u32, f64> = HashMap::new();
                    if let Some(neighbors) = adjacency.get(node) {
                        for (neighbor, w) in neighbors {
                            if !member_set.contains(neighbor) {
                                continue;
                            }
                            let nc = sub_comm[neighbor];
                            *neighbor_sub_weights.entry(nc).or_default() += *w as f64;
                        }
                    }

                    let ki_in_current =
                        neighbor_sub_weights.get(&current_sub).copied().unwrap_or(0.0);
                    let st_current = sub_sum_tot.get(&current_sub).copied().unwrap_or(0.0);
                    let remove_cost =
                        ki_in_current / two_m - ((st_current - ki) * ki) / (two_m * two_m);

                    let mut best_sub = current_sub;
                    let mut best_gain = 0.0;

                    for (&target_sub, &ki_in_target) in &neighbor_sub_weights {
                        if target_sub == current_sub {
                            continue;
                        }
                        let st_target = sub_sum_tot.get(&target_sub).copied().unwrap_or(0.0);
                        let gain = ki_in_target / two_m
                            - (st_target * ki) / (two_m * two_m)
                            - remove_cost;
                        if gain > best_gain {
                            best_gain = gain;
                            best_sub = target_sub;
                        }
                    }

                    if best_sub != current_sub {
                        *sub_sum_tot.entry(current_sub).or_default() -= ki;
                        *sub_sum_tot.entry(best_sub).or_default() += ki;
                        sub_comm.insert(node.clone(), best_sub);
                        sub_moved = true;
                    }
                }

                if !sub_moved {
                    break;
                }
            }

            for node in members {
                refined_community.insert(node.clone(), sub_comm[node]);
            }
            next_refined_label = sub_label;
        }

        community = refined_community;
    }

    // Normalize labels to 0..N
    let mut label_map: HashMap<u32, u32> = HashMap::new();
    let mut next_label = 0u32;
    let mut result: HashMap<String, u32> = HashMap::new();
    for node in &sorted_nodes {
        let c = community[node];
        let label = *label_map.entry(c).or_insert_with(|| {
            let l = next_label;
            next_label += 1;
            l
        });
        result.insert(node.clone(), label);
    }

    result
}

/// Group label propagation results into clusters, filtering by minimum size.
/// Returns Vec of (cluster members, dominant tags).
pub fn group_labels_into_clusters(
    labels: &HashMap<String, u32>,
    min_cluster_size: usize,
) -> Vec<Vec<String>> {
    let mut clusters_map: HashMap<u32, Vec<String>> = HashMap::new();
    for (node, label) in labels {
        clusters_map.entry(*label).or_default().push(node.clone());
    }

    let mut groups: Vec<Vec<String>> = clusters_map
        .into_values()
        .filter(|members| members.len() >= min_cluster_size)
        .collect();

    // Sort by size (largest first)
    groups.sort_by(|a, b| b.len().cmp(&a.len()));
    groups
}

/// Compute clusters using a simplified label propagation algorithm.
/// This groups atoms that are highly connected via semantic edges.
pub fn compute_atom_clusters(
    conn: &Connection,
    min_similarity: f32,
    min_cluster_size: i32,
    algorithm: ClusterAlgorithm,
) -> Result<Vec<AtomCluster>, String> {
    // Load all semantic edges above threshold
    let mut stmt = conn
        .prepare(
            "SELECT source_atom_id, target_atom_id, similarity_score
             FROM semantic_edges
             WHERE similarity_score >= ?1",
        )
        .map_err(|e| e.to_string())?;

    let edges: Vec<(String, String, f32)> = stmt
        .query_map([min_similarity], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if edges.is_empty() {
        return Ok(vec![]);
    }

    let labels = run_algorithm(algorithm, &edges);
    let groups = group_labels_into_clusters(&labels, min_cluster_size as usize);

    let mut clusters: Vec<AtomCluster> = Vec::new();
    for (i, atom_ids) in groups.into_iter().enumerate() {
        let dominant_tags = get_dominant_tags(conn, &atom_ids)?;
        clusters.push(AtomCluster {
            cluster_id: i as i32,
            atom_ids,
            dominant_tags,
        });
    }

    Ok(clusters)
}

/// Get the most common tags in a set of atoms
fn get_dominant_tags(conn: &Connection, atom_ids: &[String]) -> Result<Vec<String>, String> {
    if atom_ids.is_empty() {
        return Ok(vec![]);
    }

    // Build placeholders for IN clause
    let placeholders: Vec<String> = atom_ids.iter().map(|_| "?".to_string()).collect();
    let placeholders_str = placeholders.join(",");

    let sql = format!(
        "SELECT t.name, COUNT(*) as cnt
         FROM atom_tags at
         JOIN tags t ON at.tag_id = t.id
         WHERE at.atom_id IN ({})
         GROUP BY t.id
         ORDER BY cnt DESC
         LIMIT 3",
        placeholders_str
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<&dyn rusqlite::ToSql> = atom_ids
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let tags: Vec<String> = stmt
        .query_map(params.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

/// Save cluster assignments to the database
pub fn save_cluster_assignments(conn: &Connection, clusters: &[AtomCluster]) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();

    // Clear existing assignments
    conn.execute("DELETE FROM atom_clusters", [])
        .map_err(|e| e.to_string())?;

    // Insert new assignments
    let mut stmt = conn
        .prepare("INSERT INTO atom_clusters (atom_id, cluster_id, computed_at) VALUES (?1, ?2, ?3)")
        .map_err(|e| e.to_string())?;

    for cluster in clusters {
        for atom_id in &cluster.atom_ids {
            stmt.execute(rusqlite::params![atom_id, cluster.cluster_id, now])
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Get cached clusters from database
/// Returns empty vec if no clusters are cached
pub fn get_cached_clusters(conn: &Connection) -> Result<Vec<AtomCluster>, String> {
    // Check if we have cached clusters
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM atom_clusters", [], |row| row.get(0))
        .unwrap_or(0);

    if count == 0 {
        return Ok(Vec::new());
    }

    // Rebuild clusters from cached assignments
    let mut stmt = conn
        .prepare(
            "SELECT ac.cluster_id, GROUP_CONCAT(ac.atom_id)
             FROM atom_clusters ac
             GROUP BY ac.cluster_id
             ORDER BY COUNT(*) DESC",
        )
        .map_err(|e| e.to_string())?;

    let clusters: Vec<AtomCluster> = stmt
        .query_map([], |row| {
            let cluster_id: i32 = row.get(0)?;
            let atom_ids_str: String = row.get(1)?;
            let atom_ids: Vec<String> = atom_ids_str.split(',').map(|s| s.to_string()).collect();
            Ok((cluster_id, atom_ids))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(cluster_id, atom_ids)| {
            let dominant_tags = get_dominant_tags(conn, &atom_ids).unwrap_or_default();
            AtomCluster {
                cluster_id,
                atom_ids,
                dominant_tags,
            }
        })
        .collect();

    Ok(clusters)
}

/// Calculate connection counts for hub identification
pub fn get_connection_counts(
    conn: &Connection,
    min_similarity: f32,
) -> Result<HashMap<String, i32>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT atom_id, COUNT(*) as cnt FROM (
                SELECT source_atom_id as atom_id FROM semantic_edges WHERE similarity_score >= ?1
                UNION ALL
                SELECT target_atom_id as atom_id FROM semantic_edges WHERE similarity_score >= ?1
            ) GROUP BY atom_id",
        )
        .map_err(|e| e.to_string())?;

    let counts: HashMap<String, i32> = stmt
        .query_map([min_similarity], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(counts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use tempfile::NamedTempFile;

    fn create_test_db() -> (Database, NamedTempFile) {
        let temp_file = NamedTempFile::new().unwrap();
        let db = Database::open_or_create(temp_file.path()).unwrap();
        (db, temp_file)
    }

    fn insert_atom(conn: &Connection, id: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO atoms (id, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, "test content", now, now],
        )
        .unwrap();
    }

    fn insert_semantic_edge(conn: &Connection, source: &str, target: &str, similarity: f32) {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO semantic_edges (id, source_atom_id, target_atom_id, similarity_score, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, source, target, similarity, now],
        )
        .unwrap();
    }

    #[test]
    fn test_compute_clusters_empty() {
        let (db, _temp) = create_test_db();
        let conn = db.conn.lock().unwrap();

        // No edges = no clusters
        let clusters = compute_atom_clusters(&conn, 0.5, 2, ClusterAlgorithm::LabelPropagation).unwrap();
        assert!(clusters.is_empty(), "No edges should result in empty clusters");
    }

    #[test]
    fn test_compute_clusters_single_cluster() {
        let (db, _temp) = create_test_db();
        let conn = db.conn.lock().unwrap();

        // Create 3 atoms that are all connected
        insert_atom(&conn, "atom1");
        insert_atom(&conn, "atom2");
        insert_atom(&conn, "atom3");

        // Connect them all with high similarity
        insert_semantic_edge(&conn, "atom1", "atom2", 0.9);
        insert_semantic_edge(&conn, "atom2", "atom3", 0.85);
        insert_semantic_edge(&conn, "atom1", "atom3", 0.8);

        // All 3 should end up in one cluster (min_cluster_size = 2)
        let clusters = compute_atom_clusters(&conn, 0.5, 2, ClusterAlgorithm::LabelPropagation).unwrap();
        assert_eq!(clusters.len(), 1, "All connected atoms should form one cluster");
        assert_eq!(
            clusters[0].atom_ids.len(),
            3,
            "Cluster should contain all 3 atoms"
        );
    }

    #[test]
    fn test_save_and_get_cached_clusters() {
        let (db, _temp) = create_test_db();
        let conn = db.conn.lock().unwrap();

        // Create atoms
        insert_atom(&conn, "atom1");
        insert_atom(&conn, "atom2");
        insert_atom(&conn, "atom3");

        // Create a cluster manually
        let clusters = vec![AtomCluster {
            cluster_id: 0,
            atom_ids: vec!["atom1".to_string(), "atom2".to_string(), "atom3".to_string()],
            dominant_tags: vec![],
        }];

        // Save clusters
        save_cluster_assignments(&conn, &clusters).unwrap();

        // Retrieve cached clusters
        let cached = get_cached_clusters(&conn).unwrap();
        assert_eq!(cached.len(), 1, "Should have one cached cluster");
        assert_eq!(
            cached[0].atom_ids.len(),
            3,
            "Cached cluster should have 3 atoms"
        );
    }

    #[test]
    fn test_get_connection_counts() {
        let (db, _temp) = create_test_db();
        let conn = db.conn.lock().unwrap();

        // Create atoms
        insert_atom(&conn, "hub");
        insert_atom(&conn, "spoke1");
        insert_atom(&conn, "spoke2");
        insert_atom(&conn, "spoke3");

        // Hub connects to all spokes with high similarity
        insert_semantic_edge(&conn, "hub", "spoke1", 0.9);
        insert_semantic_edge(&conn, "hub", "spoke2", 0.85);
        insert_semantic_edge(&conn, "hub", "spoke3", 0.8);

        let counts = get_connection_counts(&conn, 0.5).unwrap();

        // Hub should have 3 connections
        assert_eq!(counts.get("hub"), Some(&3), "Hub should have 3 connections");
        // Each spoke should have 1 connection
        assert_eq!(
            counts.get("spoke1"),
            Some(&1),
            "Spoke1 should have 1 connection"
        );
        assert_eq!(
            counts.get("spoke2"),
            Some(&1),
            "Spoke2 should have 1 connection"
        );
        assert_eq!(
            counts.get("spoke3"),
            Some(&1),
            "Spoke3 should have 1 connection"
        );
    }
}
