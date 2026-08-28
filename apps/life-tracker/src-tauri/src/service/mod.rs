//! 业务逻辑层 —— 包装 data/ 处理缓存、状态、初始化。
//!
//! - `goals` — 业务规则(create 分配 id / update 合并 patch 等)
//! - `relations` — 前置关系 + cycle validate
//! - `config` — 配置读写
//! - `data_dir` — 双仓分离 + cache + 初始化 + picker(通用逻辑在 tracker-core)
//! - `trash` — 回收站（删除目标移到 `.trash/`，可还原）

pub mod config;
pub mod data_dir;
pub mod goals;
pub mod relations;
pub mod trash;
