//! 业务逻辑层 —— 包装 data/ 处理缓存、状态、初始化。
//!
//! 与 `src/main/service/` 1:1 对应:
//! - `books` — 业务规则(create 分配 id / update 合并 patch 等)
//! - `series` — 系列业务逻辑(v1.7 起;含删除时的脏引用清理)
//! - `relations` — 同 data,只加 validate 钩子
//! - `config` — 同 data
//! - `ranking` — 两两对比排名历史的读 / 追加（评分由前端实时计算）
//! - `data_dir` — 双仓分离 + cache + 初始化 + picker
//!
//! 缓存策略:data_dir / config 全局缓存,books / relations / ranking / series 实时读(数据可能很大,
//! 实时读避免 cache 失效问题)。

pub mod books;
pub mod config;
pub mod data_dir;
pub mod ranking;
pub mod relations;
pub mod series;
