//! 数据访问层 —— Goal 领域文件 I/O。
//!
//! 通用文件 I/O（原子写 / JSON / 数字 ID / relations.json / config 骨架）已抽到
//! `crates/tracker-core`，本模块只保留 Goal 专属的 frontmatter 读写。

pub mod config;
pub mod goals;
