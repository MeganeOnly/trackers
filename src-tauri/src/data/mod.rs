//! 数据访问层 —— fs I/O + matter frontmatter 解析。
//!
//! 与 `src/main/data/` 1:1 对应。无业务逻辑,纯 fs 操作。
//! 上层 `service/` 包装业务规则(create/update/bump/delete 等)。

pub mod books;
pub mod config;
pub mod files;
pub mod relations;
pub mod slug;
