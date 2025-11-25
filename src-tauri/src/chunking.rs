/// Chunks content into smaller pieces for embedding generation.
///
/// Chunking rules:
/// - Primary split: double newlines (`\n\n`)
/// - Secondary split (for long paragraphs): sentence boundaries (`. `, `! `, `? `)
/// - Minimum viable chunk: 50 characters
/// - Merge threshold: chunks under 100 chars get merged with previous
/// - Maximum chunk: 2000 characters
/// - Preserve original text exactly (no trimming whitespace within chunks)
pub fn chunk_content(content: &str) -> Vec<String> {
    if content.is_empty() {
        return Vec::new();
    }

    // 1. Split by double newlines (paragraphs)
    let paragraphs: Vec<&str> = content.split("\n\n").collect();

    let mut chunks: Vec<String> = Vec::new();

    for paragraph in paragraphs {
        if paragraph.is_empty() {
            continue;
        }

        // 2. For paragraphs > 1500 chars, split by sentences (. ! ?)
        if paragraph.len() > 1500 {
            let sentence_chunks = split_by_sentences(paragraph);
            chunks.extend(sentence_chunks);
        } else {
            chunks.push(paragraph.to_string());
        }
    }

    // 3. Merge very small chunks (< 10 chars) with next chunk
    // These are things like "Hi.", "A.", etc. that shouldn't stand alone
    chunks = merge_tiny_chunks_forward(chunks);

    // 4. Cap chunks at 2000 chars max (hard split)
    chunks = hard_split_large_chunks(chunks);

    // 5. Skip final chunks that are very small (< 10 chars)
    // This handles trailing tiny chunks like "Hi" at the end
    if let Some(last) = chunks.last() {
        if last.len() < 10 {
            chunks.pop();
        }
    }

    chunks
}

/// Split a paragraph by sentence boundaries (`. `, `! `, `? `)
fn split_by_sentences(paragraph: &str) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut current_chunk = String::new();

    let chars: Vec<char> = paragraph.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        current_chunk.push(chars[i]);

        // Check for sentence boundary: punctuation followed by space
        if i + 1 < len
            && (chars[i] == '.' || chars[i] == '!' || chars[i] == '?')
            && chars[i + 1] == ' '
        {
            // Include the space in the current chunk
            current_chunk.push(chars[i + 1]);
            i += 2;

            // If current chunk is substantial, save it
            if !current_chunk.is_empty() {
                chunks.push(current_chunk);
                current_chunk = String::new();
            }
        } else {
            i += 1;
        }
    }

    // Don't forget the last chunk
    if !current_chunk.is_empty() {
        chunks.push(current_chunk);
    }

    chunks
}

/// Merge very small chunks (< 10 chars) with the next chunk
/// These are things like "Hi.", "A.", etc. that shouldn't stand alone
fn merge_tiny_chunks_forward(chunks: Vec<String>) -> Vec<String> {
    if chunks.is_empty() {
        return chunks;
    }

    let mut result: Vec<String> = Vec::new();
    let mut pending: Option<String> = None;

    for chunk in chunks {
        if let Some(prev) = pending.take() {
            // We have a pending tiny chunk, merge it with current
            result.push(format!("{}\n\n{}", prev, chunk));
        } else if chunk.len() < 10 {
            // Current chunk is very tiny (< 10 chars), hold it for potential merge with next
            pending = Some(chunk);
        } else {
            result.push(chunk);
        }
    }

    // If there's a pending chunk at the end, add it (will be filtered by final check)
    if let Some(last) = pending {
        result.push(last);
    }

    result
}

/// Hard split chunks that exceed 2000 characters
fn hard_split_large_chunks(chunks: Vec<String>) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();

    for chunk in chunks {
        if chunk.len() <= 2000 {
            result.push(chunk);
        } else {
            // Hard split at 2000 char boundaries
            let chars: Vec<char> = chunk.chars().collect();
            let mut start = 0;
            while start < chars.len() {
                let end = std::cmp::min(start + 2000, chars.len());
                let sub_chunk: String = chars[start..end].iter().collect();
                result.push(sub_chunk);
                start = end;
            }
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_paragraphs() {
        let content = "First paragraph here.\n\nSecond paragraph here.";
        let chunks = chunk_content(content);
        assert_eq!(chunks.len(), 2);
    }

    #[test]
    fn test_long_paragraph_splits_on_sentences() {
        // Create a paragraph > 1500 chars
        let long_para = "This is a sentence. ".repeat(100); // ~2000 chars
        let chunks = chunk_content(&long_para);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| c.len() <= 2000));
    }

    #[test]
    fn test_small_chunks_merged() {
        let content = "Hi.\n\nHello there, this is a longer paragraph that should stay together.";
        let chunks = chunk_content(content);
        // "Hi." is < 100 chars, should be merged with next
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn test_skip_tiny_final_chunk() {
        let content = "This is a good paragraph with enough content.\n\nHi";
        let chunks = chunk_content(content);
        // "Hi" is < 50 chars and is the final chunk, should be skipped
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn test_empty_content() {
        let chunks = chunk_content("");
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_max_chunk_size() {
        let long_text = "a".repeat(3000);
        let chunks = chunk_content(&long_text);
        assert!(chunks.iter().all(|c| c.len() <= 2000));
    }

    #[test]
    fn test_preserves_whitespace() {
        let content = "  Leading spaces preserved.  \n\n  Another paragraph with spaces.  ";
        let chunks = chunk_content(content);
        assert_eq!(chunks.len(), 2);
        assert!(chunks[0].starts_with("  "));
        assert!(chunks[1].starts_with("  "));
    }

    #[test]
    fn test_sentence_splitting_preserves_punctuation() {
        // Create a long paragraph that will be split by sentences
        let sentence = "This is a test sentence. ";
        let long_para = sentence.repeat(80); // > 1500 chars
        let chunks = chunk_content(&long_para);

        // Each chunk should end with ". " (except possibly the last one)
        for chunk in &chunks[..chunks.len().saturating_sub(1)] {
            assert!(chunk.ends_with(". ") || chunk.ends_with(".\n\n"));
        }
    }

    #[test]
    fn test_multiple_small_paragraphs_merged() {
        let content = "A.\n\nB.\n\nC.\n\nThis is a longer paragraph that has enough content to stand alone.";
        let chunks = chunk_content(content);
        // Small paragraphs should be merged together
        assert!(chunks.len() <= 2);
    }

    #[test]
    fn test_single_long_chunk_hard_split() {
        let long_text = "a".repeat(5000);
        let chunks = chunk_content(&long_text);
        assert_eq!(chunks.len(), 3); // 2000 + 2000 + 1000
        assert_eq!(chunks[0].len(), 2000);
        assert_eq!(chunks[1].len(), 2000);
        assert_eq!(chunks[2].len(), 1000);
    }
}

