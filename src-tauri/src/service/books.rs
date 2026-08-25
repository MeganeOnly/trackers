//! book 业务逻辑 —— 包装 data/books,加容错和 ID 复用。

use std::collections::HashSet;
use std::path::Path;

use crate::data::books as data;
use crate::types::{Book, BookInput, BookPatch};

/// 列出所有书 + 损坏列表。
pub fn list_books(books_dir: impl AsRef<Path>) -> std::io::Result<data::BookListResult> {
    data::read_all_books(books_dir)
}

/// 读取一本书。
pub fn get_book(books_dir: impl AsRef<Path>, id: &str) -> std::io::Result<Option<Book>> {
    data::read_book(books_dir, id)
}

/// 创建一本书 —— 自动分配新 ID。
pub fn create_book(books_dir: impl AsRef<Path>, input: &BookInput) -> std::io::Result<Book> {
    let ids: HashSet<String> = data::list_book_ids(&books_dir)?.into_iter().collect();
    data::write_book(&books_dir, input, &ids)
}

/// 更新一本书 —— patch 合并。
pub fn update_book(books_dir: impl AsRef<Path>, id: &str, patch: &BookPatch) -> std::io::Result<Book> {
    data::update_book(books_dir, id, patch)
}

/// 快速调整 progress。
pub fn bump_progress(books_dir: impl AsRef<Path>, id: &str, delta: i32) -> std::io::Result<Book> {
    data::bump_progress(books_dir, id, delta)
}

/// 删除一本书。
pub fn delete_book(books_dir: impl AsRef<Path>, id: &str) -> std::io::Result<()> {
    data::delete_book(books_dir, id)
}
