//! 唤醒词文本 → sherpa-onnx KWS token 编码。
//!
//! 背景（详见 memory `luckyisland-m8-voice`）：KWS 模型的 keywords.txt 格式不是逐字符
//! 查表，是标准汉语拼音「声母 + 韵母」拆分——每个汉字转带调拼音后，按声母表做最长前缀
//! 匹配拆成两个 token（零声母字整个带调音节是一个 token），空格分隔，末尾加
//! `@原始短语`。实测样例（下载真实模型验证过）：
//!   你好军哥  ->  n ǐ h ǎo j ūn g ē @你好军哥
//!   小爱同学  ->  x iǎo ài t óng x ué @小爱同学
//!
//! 只支持纯中文短语（中英混合唤醒词需要真正的 BPE，本次不做，见 memory）。

use pinyin::ToPinyin;
use std::collections::HashMap;

/// 标准汉语拼音声母表（23 个），按长度降序排列以便做最长前缀匹配（zh/ch/sh 优先于 z/c/s）。
/// y/w 按声母处理（对应 tokens.txt 里确有独立的 y/w token）。
const INITIALS: &[&str] = &[
    "zh", "ch", "sh", // 长度 2 的优先匹配
    "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y",
    "w",
];

/// 一个汉字编码失败的原因，用于生成用户可读的错误提示
#[derive(Debug)]
pub enum EncodeError {
    /// 字符不是中文（不在 pinyin 数据表里）
    NotChinese(char),
    /// 拆出的声母或韵母不在模型 tokens.txt 里（模型不认识这个音节，理论上不该发生，
    /// 除非声母表拆分逻辑跟模型训练时用的拆分规则对不上）
    UnknownToken(char, String),
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncodeError::NotChinese(c) => write!(f, "「{c}」不是中文字符，唤醒词只支持纯中文"),
            EncodeError::UnknownToken(c, part) => {
                write!(f, "「{c}」的拼音片段「{part}」不在模型词表里，换一个字试试")
            }
        }
    }
}

/// 从模型的 tokens.txt 内容构建 token 表（token 字符串 -> 是否存在，编码时只需判断是否在表里，
/// 真正喂给 KWS 的是 token 字符串本身而不是 ID，sherpa-onnx 的 keywords_file/keywords_buf
/// 接受的就是形如 "n ǐ h ǎo @你好" 这种文本格式，不需要我们自己转 ID）。
pub struct TokenTable {
    tokens: HashMap<String, ()>,
}

impl TokenTable {
    /// 解析 tokens.txt：每行 "<token> <id>"，取第一列。
    pub fn load(tokens_txt_content: &str) -> Self {
        let mut tokens = HashMap::new();
        for line in tokens_txt_content.lines() {
            if let Some((tok, _id)) = line.rsplit_once(' ') {
                tokens.insert(tok.to_string(), ());
            }
        }
        Self { tokens }
    }

    fn contains(&self, tok: &str) -> bool {
        self.tokens.contains_key(tok)
    }
}

/// 把一个带调拼音音节（如 "nǐ"、"ài"）拆成 (声母, 韵母) 或 (None, 整个音节)（零声母）。
fn split_syllable(syllable: &str) -> (Option<&str>, &str) {
    for initial in INITIALS {
        if let Some(rest) = syllable.strip_prefix(initial) {
            // 剩余部分不能为空（比如音节本身就等于声母是不可能的，汉语拼音声母不能单独成音节），
            // 为空说明误匹配（理论上不会发生，保险起见仍剩余部分为空时按零声母处理）
            if !rest.is_empty() {
                return (Some(initial), rest);
            }
        }
    }
    (None, syllable)
}

/// 编码一个纯中文唤醒词短语，返回 KWS 要的编码行（不含末尾换行）。
/// 例："你好军哥" -> "n ǐ h ǎo j ūn g ē @你好军哥"
pub fn encode_keyword(phrase: &str, tokens: &TokenTable) -> Result<String, EncodeError> {
    let mut parts: Vec<String> = Vec::new();

    for ch in phrase.chars() {
        let py = ch
            .to_pinyin()
            .ok_or(EncodeError::NotChinese(ch))?;
        let syllable = py.with_tone(); // 带调拼音，如 "nǐ"

        let (initial, r#final) = split_syllable(syllable);

        if let Some(initial) = initial {
            if !tokens.contains(initial) {
                return Err(EncodeError::UnknownToken(ch, initial.to_string()));
            }
            parts.push(initial.to_string());
        }
        if !tokens.contains(r#final) {
            return Err(EncodeError::UnknownToken(ch, r#final.to_string()));
        }
        parts.push(r#final.to_string());
    }

    if parts.is_empty() {
        return Err(EncodeError::NotChinese(' '));
    }

    Ok(format!("{} @{phrase}", parts.join(" ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 用真实模型的 tokens.txt 片段构造测试表（只含验证过的样例用到的 token，
    /// 完整表见下载的真实模型文件，规划阶段已核实这份数据）
    fn test_tokens() -> TokenTable {
        let content = "n 1\nǐ 2\nh 3\nǎo 4\nj 5\nūn 6\ng 7\nē 8\n\
                        x 9\niǎo 10\nài 11\nt 12\nóng 13\nué 14\n\
                        d 15\nàn 16\nw 17\nèn 18\ny 19\nì 20\n\
                        m 21\nl 22\nín 23\něi 24\n\
                        1 100";
        TokenTable::load(content)
    }

    #[test]
    fn encodes_ni_hao_jun_ge() {
        let tokens = test_tokens();
        assert_eq!(
            encode_keyword("你好军哥", &tokens).unwrap(),
            "n ǐ h ǎo j ūn g ē @你好军哥"
        );
    }

    #[test]
    fn encodes_zero_initial_ai() {
        let tokens = test_tokens();
        assert_eq!(
            encode_keyword("小爱同学", &tokens).unwrap(),
            "x iǎo ài t óng x ué @小爱同学"
        );
    }

    #[test]
    fn rejects_non_chinese() {
        let tokens = test_tokens();
        let err = encode_keyword("hi你好", &tokens).unwrap_err();
        assert!(matches!(err, EncodeError::NotChinese('h')));
    }

    /// 零声母（"安"->ān）不应被误判成有声母——tokens.txt 里没有任何以 a/e/o 开头的多字符
    /// 声母条目，`split_syllable` 遍历 INITIALS 找不到前缀匹配时应整体当韵母处理。
    #[test]
    fn zero_initial_a_series_not_misparsed() {
        // 手动验证 split_syllable 的行为，不依赖具体 token 表内容（这条只测拆分逻辑本身）
        let (initial, r#final) = split_syllable("ān");
        assert_eq!(initial, None);
        assert_eq!(r#final, "ān");
    }
}
