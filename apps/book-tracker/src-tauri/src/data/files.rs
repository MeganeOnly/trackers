//! 通用文件 I/O 工具:确保目录、原子写、JSON 读写。
//!
//! 与 `src/main/data/files.ts` 1:1 对应。原子写策略:先写 `<path>.tmp` 再 rename,
//! 避免半截文件留在磁盘上。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;

/// 确保目录存在(递归创建)。
pub fn ensure_dir(dir: impl AsRef<Path>) -> std::io::Result<()> {
    fs::create_dir_all(dir.as_ref())
}

/// 原子写文件:先写 `.tmp` 再 rename。
/// 失败时保留 `.tmp` 以便排查(不会留下半截目标文件)。
pub fn atomic_write_file(file_path: impl AsRef<Path>, content: &str) -> std::io::Result<()> {
    let file_path = file_path.as_ref();
    if let Some(parent) = file_path.parent() {
        ensure_dir(parent)?;
    }
    let tmp: PathBuf = {
        let mut s = file_path.as_os_str().to_owned();
        s.push(".tmp");
        PathBuf::from(s)
    };
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    // Windows 上 rename 不会原子覆盖已存在文件 → 先 remove 再 rename
    if file_path.exists() {
        fs::remove_file(file_path)?;
    }
    fs::rename(&tmp, file_path)
}

/// 读 JSON;文件不存在返回 fallback。
pub fn read_json<T: DeserializeOwned>(file_path: impl AsRef<Path>, fallback: T) -> std::io::Result<T> {
    match fs::read_to_string(file_path.as_ref()) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(fallback),
        Err(e) => Err(e),
    }
}

/// 写 JSON(原子)。pretty + 末尾换行,与 TS 版格式一致。
pub fn write_json(file_path: impl AsRef<Path>, data: &impl serde::Serialize) -> std::io::Result<()> {
    let s = serde_json::to_string_pretty(data).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    atomic_write_file(file_path, &(s + "\n"))
}

// ==================== 单测 ====================

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use tempfile::tempdir;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct Sample {
        a: u32,
        b: String,
    }

    #[test]
    fn ensure_dir_creates_nested() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("a").join("b").join("c");
        ensure_dir(&nested).unwrap();
        assert!(nested.is_dir());
    }

    #[test]
    fn atomic_write_creates_parent_dirs() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("nested").join("file.txt");
        atomic_write_file(&target, "hello").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello");
    }

    #[test]
    fn atomic_write_overwrites_existing() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("f.txt");
        atomic_write_file(&target, "v1").unwrap();
        atomic_write_file(&target, "v2").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "v2");
        // 没有残留 .tmp
        assert!(!dir.path().join("f.txt.tmp").exists());
    }

    #[test]
    fn read_json_returns_fallback_on_missing() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("missing.json");
        let fallback = Sample { a: 0, b: "fallback".to_string() };
        let got: Sample = read_json(&target, fallback.clone()).unwrap();
        assert_eq!(got, fallback);
    }

    #[test]
    fn write_and_read_json_round_trip() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("x.json");
        let original = Sample { a: 42, b: "hello".to_string() };
        write_json(&target, &original).unwrap();
        let got: Sample = read_json(&target, Sample { a: 0, b: String::new() }).unwrap();
        assert_eq!(got, original);
    }

    #[test]
    fn read_json_propagates_invalid_json_error() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("bad.json");
        fs::write(&target, "not valid json {{{").unwrap();
        let result: std::io::Result<Sample> = read_json(&target, Sample { a: 0, b: String::new() });
        assert!(result.is_err());
    }
}
