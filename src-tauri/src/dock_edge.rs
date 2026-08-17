use serde::{Deserialize, Serialize};

/// 当前界面模式的窗口停靠边。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockEdge {
    #[default]
    Top,
    Bottom,
    Left,
    Right,
}

impl DockEdge {
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("bottom") => Self::Bottom,
            Some("left") => Self::Left,
            Some("right") => Self::Right,
            _ => Self::Top,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Top => "top",
            Self::Bottom => "bottom",
            Self::Left => "left",
            Self::Right => "right",
        }
    }

    pub const fn is_vertical(self) -> bool {
        matches!(self, Self::Left | Self::Right)
    }

    #[cfg(test)]
    pub fn key(self, mode: &str) -> String {
        format!("window:dock_edge:{mode}")
    }
}

#[cfg(test)]
mod tests {
    use super::DockEdge;

    #[test]
    fn parses_and_normalizes_edges() {
        assert_eq!(DockEdge::parse(None), DockEdge::Top);
        assert_eq!(DockEdge::parse(Some("")), DockEdge::Top);
        assert_eq!(DockEdge::parse(Some("garbage")), DockEdge::Top);
        assert_eq!(DockEdge::parse(Some(" left ")), DockEdge::Left);
        assert_eq!(DockEdge::parse(Some("bottom")), DockEdge::Bottom);
        assert_eq!(DockEdge::Right.as_str(), "right");
        assert!(DockEdge::Left.is_vertical());
        assert!(!DockEdge::Top.is_vertical());
        assert_eq!(
            DockEdge::Right.key("classisland"),
            "window:dock_edge:classisland"
        );
    }
}
