//! tracker-core —— 两个 tracker app（book-tracker / life-tracker）共享的 Rust 内核。
//!
//! 领域无关（不依赖 Tauri / 不依赖任何 app 类型）：
//! - `types`      跨进程共享类型（Edge / Progress / UnlockResult …）
//! - `files`      原子写 / JSON 读写 / ensure_dir
//! - `slug`       纯数字 ID 生成
//! - `unlock`     前置依赖图 + 环检测（done map 参数化）
//! - `progress`   N/M 进度纯函数
//! - `frontmatter` markdown `---` frontmatter 拆分 + ISO 时间戳
//! - `relations`  relations.json 读写 + 边容错
//! - `validate`   relations 不变量校验（只报告，不改数据、不阻止读写）
//! - `config`     config.json 读写骨架（领域 Config 由各 app 定义）
//!
//! 共享边界约定见仓库根 `docs/shared-boundary.md`。

pub mod config;
pub mod data_dir;
pub mod files;
pub mod frontmatter;
pub mod progress;
pub mod relations;
pub mod slug;
pub mod types;
pub mod unlock;
pub mod validate;

pub use types::{
    Edge, ExcludeEffect, PrereqSpec, Progress, RelationsFile, UnlockResult, UnlockRule,
};
pub use unlock::{compute_blocking_relations, BlockingRelation};
pub use validate::{validate_edges, EdgeIssue, CODE_CYCLE, CODE_DUPLICATE_TO};
