//! ranking 业务逻辑 —— 包装 `data::ranking`，加前端期望的语义整理。
//!
//! 存储约定：`history` 由前端追加（前端持有 books 全量，能给每条新结果正确地决定 a/b 顺序 + ts），
//! 本 service 只做"读 / 追加并写回"。评分由前端实时从 history + 当前 books pool 重算。

use std::path::Path;

use tracker_core::{frontmatter, PairwiseResult, RankingFile};

use crate::data::ranking as data;

/// 读当前 ranking 文件（缺失 → 返回默认空 RankingFile）。
pub fn get_ranking(data_dir: impl AsRef<Path>) -> std::io::Result<RankingFile> {
    data::read_ranking(data_dir)
}

/// 追加一条对比结果并写回。
///
/// 约定由前端保证：
/// - `result.a` / `result.b` 是当前有效的 book id
/// - `result.winner` 是 `'a'` / `'b'` / `'tie'`
///
/// 后端只做：
/// - 用服务端时钟覆盖 `ts`（避免前端时钟漂移）
/// - 原子写整文件
pub fn append_result(data_dir: impl AsRef<Path>, result: PairwiseResult) -> std::io::Result<RankingFile> {
    let mut file = data::read_ranking(data_dir.as_ref())?;
    let mut entry = result;
    entry.ts = frontmatter::now_iso();
    file.history.push(entry);
    data::write_ranking(data_dir.as_ref(), &file)?;
    Ok(file)
}
