//! Community posts' Markdown, rendered to HTML the site can show as is.
//!
//! Sensitive: the site inserts this HTML into its pages, so everything that could run or load something is
//! taken out here, once. Raw HTML in a post is shown as text. Links keep only web, mail and on-site
//! addresses, and open as `nofollow noopener`. Images become their alt text, so a post can't make visitors
//! load something from another site.

use pulldown_cmark::{CowStr, Event, Options, Parser, Tag, TagEnd, html};
use url::Url;

/// The post's body as safe HTML.
pub fn to_html(markdown: &str) -> String {
    // Whether each open link was kept, so its end is kept or dropped to match.
    let mut links: Vec<bool> = Vec::new();
    let events = Parser::new_ext(markdown, Options::ENABLE_STRIKETHROUGH).filter_map(|event| {
        Some(match event {
            Event::Html(text) | Event::InlineHtml(text) => Event::Text(text),
            Event::Start(Tag::Image { .. }) | Event::End(TagEnd::Image) => return None,
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                title,
                id,
            }) => {
                let safe = safe_href(&dest_url);
                links.push(safe.is_some());
                Event::Start(Tag::Link {
                    link_type,
                    dest_url: CowStr::from(safe?),
                    title,
                    id,
                })
            }
            Event::End(TagEnd::Link) => {
                if !links.pop().unwrap_or(false) {
                    return None;
                }
                Event::End(TagEnd::Link)
            }
            // A post's own headings sit under the page's title, so they start at h2.
            Event::Start(Tag::Heading {
                level,
                id,
                classes,
                attrs,
            }) => Event::Start(Tag::Heading {
                level: level.max(pulldown_cmark::HeadingLevel::H2),
                id,
                classes,
                attrs,
            }),
            Event::End(TagEnd::Heading(level)) => {
                Event::End(TagEnd::Heading(level.max(pulldown_cmark::HeadingLevel::H2)))
            }
            other => other,
        })
    });
    let mut out = String::new();
    html::push_html(&mut out, events);
    // Raw HTML became text above, so every `<a href=` here is a link from Markdown.
    out.replace("<a href=", r#"<a rel="nofollow noopener noreferrer" href="#)
}

/// A post's opening words as plain text, for lists: at most `max` characters, cut at a word. Blocks (a
/// heading, a paragraph, a list item) are set apart by `BLOCK_BREAK` unless the first already ends in
/// punctuation, so a list doesn't read as one sentence.
pub fn excerpt(markdown: &str, max: usize) -> String {
    let mut text = String::new();
    let mut block_ended = false;
    for event in Parser::new_ext(markdown, Options::ENABLE_STRIKETHROUGH) {
        match event {
            Event::Text(part) | Event::Code(part) => {
                // Nested blocks end together (an item's paragraph, the item, the list): one break for all.
                if std::mem::take(&mut block_ended) {
                    let ended = text.trim_end();
                    let sentence_over = ended.ends_with(['.', '!', '?', ':', ';', ',', '…']);
                    text.push_str(if ended.is_empty() || sentence_over {
                        " "
                    } else {
                        BLOCK_BREAK
                    });
                }
                text.push_str(&part);
            }
            // Line breaks separate words; inline ends (bold, links) don't.
            Event::SoftBreak | Event::HardBreak => text.push(' '),
            Event::End(end) if !is_inline(end) => block_ended = true,
            _ => {}
        }
        if text.chars().count() > max {
            break;
        }
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max {
        return text;
    }
    let cut: String = text.chars().take(max).collect();
    let cut = cut.rsplit_once(' ').map_or(cut.as_str(), |(head, _)| head);
    format!(
        "{}…",
        cut.trim_end_matches(|c: char| c.is_ascii_punctuation() || c == '·' || c == ' ')
    )
}

/// What stands between two blocks in an excerpt.
const BLOCK_BREAK: &str = " · ";

fn is_inline(end: TagEnd) -> bool {
    matches!(
        end,
        TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link | TagEnd::Image
    )
}

/// Web and mail addresses, normalized; and paths on this site. Anything else (`javascript:`, `data:`, …)
/// isn't a link.
fn safe_href(href: &str) -> Option<String> {
    if href.starts_with('/') && !href.starts_with("//") {
        return Some(href.to_owned());
    }
    let url = Url::parse(href).ok()?;
    matches!(url.scheme(), "https" | "http" | "mailto").then(|| url.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_markdown() {
        assert_eq!(
            to_html("# Update\n\nNew **maps** and ~~old~~ news."),
            "<h2>Update</h2>\n<p>New <strong>maps</strong> and <del>old</del> news.</p>\n"
        );
    }

    #[test]
    fn raw_html_shows_as_text() {
        let html = to_html("<script>alert(1)</script>\n\nHi <img src=x onerror=alert(1)>");
        assert!(!html.contains("<script"), "{html}");
        assert!(!html.contains("<img"), "{html}");
        assert!(html.contains("&lt;script&gt;"), "{html}");
    }

    #[test]
    fn keeps_only_safe_links() {
        assert_eq!(
            to_html("[map](https://sourcejump.net/maps/bhop_eazy) [home](/)"),
            "<p><a rel=\"nofollow noopener noreferrer\" href=\"https://sourcejump.net/maps/bhop_eazy\">map</a> \
             <a rel=\"nofollow noopener noreferrer\" href=\"/\">home</a></p>\n"
        );
        assert_eq!(
            to_html("[click](javascript:alert(1)) [x](//evil.example)"),
            "<p>click x</p>\n"
        );
    }

    #[test]
    fn images_become_their_alt_text() {
        assert_eq!(
            to_html("![a jump](https://tracker.example/pixel.png)"),
            "<p>a jump</p>\n"
        );
    }

    #[test]
    fn excerpts_cut_at_a_word() {
        assert_eq!(
            excerpt("# Title\n\nSome *text* here.", 100),
            "Title · Some text here."
        );
        assert_eq!(
            excerpt(
                "Maps:\n\n- bhop_eazy, a *short* warm-up\n- bhop_monster_jam, long\n\nDone. \n\nBye",
                100
            ),
            "Maps: bhop_eazy, a short warm-up · bhop_monster_jam, long · Done. Bye"
        );
        assert_eq!(excerpt("# One\n\ntwo three", 6), "One…");
        assert_eq!(excerpt("one two three four", 12), "one two…");
        assert_eq!(
            excerpt("Some *emphasis*, **bold** and ~~struck~~ [links](/).", 100),
            "Some emphasis, bold and struck links."
        );
    }
}
