use std::path::Path;

use super::Scene;

/// Parse a scene from a JSON file on disk.
pub fn parse_scene_file(path: &Path) -> Result<Scene, String> {
    let contents = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    parse_scene_json(&contents)
}

/// Parse a scene from a JSON string.
pub fn parse_scene_json(json: &str) -> Result<Scene, String> {
    serde_json::from_str(json).map_err(|e| format!("invalid scene JSON: {e}"))
}
