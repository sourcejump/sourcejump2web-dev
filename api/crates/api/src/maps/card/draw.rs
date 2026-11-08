//! Drawing link cards: the 1200×630 pictures that link previews (Discord, Steam, X) show for a page. A map's card
//! is its cover with the SourceJump wordmark, the map's tier icon and its name; the site's card, used where a page
//! has no picture of its own, is the home page's header picture with the wordmark and the site's description.
//!
//! Text is set in Play, the site's font (`assets/play/`, SIL Open Font License), so cards match the pages.
//! Cards are JPEG rather than the WebP the map pictures use: some link previewers still don't show WebP.

// Pixel positions move between whole and fractional numbers here; all of them are a few thousand at most, far
// inside what f32 holds exactly, and the drawing code skips any that land off the card.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use std::{io::Cursor, sync::LazyLock};

use ab_glyph::{Font, FontRef, Glyph, PxScale, ScaleFont, point};
use image::{ImageReader, RgbImage, RgbaImage, codecs::jpeg::JpegEncoder, imageops::FilterType};

/// Open Graph's recommended size; Discord and X show it without cropping.
pub const SIZE: (u32, u32) = (1200, 630);
/// JPEG quality, 0–100. 85 keeps the text's edges clean at around 60–90 KB a card.
const QUALITY: u8 = 85;

/// The site's colours (`web/src/ui/tokens.css`): the page background, text, muted text and accent.
const BACKGROUND: [u8; 3] = [0x0e, 0x16, 0x22];
const TEXT: [u8; 3] = [0xe3, 0xea, 0xf3];
const TEXT_SOFT: [u8; 3] = [0xc4, 0xd0, 0xe0];
const ACCENT: [u8; 3] = [0x00, 0xc8, 0xf0];

/// The space between the card's edge and its text, as on the site's pages at their widest.
const MARGIN: f32 = 64.0;

static BOLD: LazyLock<FontRef<'static>> = LazyLock::new(|| {
    FontRef::try_from_slice(include_bytes!("../../../assets/play/Play-Bold.ttf"))
        .expect("the bundled font is valid")
});
static REGULAR: LazyLock<FontRef<'static>> = LazyLock::new(|| {
    FontRef::try_from_slice(include_bytes!("../../../assets/play/Play-Regular.ttf"))
        .expect("the bundled font is valid")
});

/// The tier icons the Discord record feed shows (`scripts/tier-icons.py`), shared so a map's tier looks the same
/// in a record post and in a link to the map. Index is the tier.
const TIER_ICONS: [&[u8]; 11] = [
    include_bytes!("../../../../../../web/public/tiers/t0.png"),
    include_bytes!("../../../../../../web/public/tiers/t1.png"),
    include_bytes!("../../../../../../web/public/tiers/t2.png"),
    include_bytes!("../../../../../../web/public/tiers/t3.png"),
    include_bytes!("../../../../../../web/public/tiers/t4.png"),
    include_bytes!("../../../../../../web/public/tiers/t5.png"),
    include_bytes!("../../../../../../web/public/tiers/t6.png"),
    include_bytes!("../../../../../../web/public/tiers/t7.png"),
    include_bytes!("../../../../../../web/public/tiers/t8.png"),
    include_bytes!("../../../../../../web/public/tiers/t9.png"),
    include_bytes!("../../../../../../web/public/tiers/t10.png"),
];
const TIER_ICON_SIZE: u32 = 112;

/// The site's description, as the web app's root layout gives it.
const SITE_DESCRIPTION: &str = "Global records for the Counter-Strike: Source bunnyhop community.";

/// A map's card: the cover (a stored map picture), the wordmark, the tier icon when there is a tier to show, and
/// the name. A tier without an icon (above 10) is left out rather than drawn some other way.
pub fn map_card(cover: &[u8], name: &str, tier: Option<i16>) -> Result<Vec<u8>, String> {
    let mut card = background(cover)?;
    // Darkened at the top for the wordmark and more at the bottom for the name, so both read on a bright cover.
    shade_down(
        &mut card,
        &[
            (0.0, 0.82),
            (0.30, 0.0),
            (0.45, 0.0),
            (0.72, 0.78),
            (1.0, 0.96),
        ],
    );
    wordmark(&mut card, 34.0, MARGIN, 52.0);

    let center = SIZE.1 as f32 - 58.0 - TIER_ICON_SIZE as f32 / 2.0;
    let mut left = MARGIN;
    if let Some(icon) = tier.and_then(|tier| TIER_ICONS.get(usize::try_from(tier).ok()?)) {
        let icon = image::load_from_memory(icon)
            .expect("the bundled tier icons are valid")
            .to_rgba8();
        let icon =
            image::imageops::resize(&icon, TIER_ICON_SIZE, TIER_ICON_SIZE, FilterType::Lanczos3);
        overlay(
            &mut card,
            &icon,
            left as i64,
            (center - TIER_ICON_SIZE as f32 / 2.0) as i64,
        );
        left += TIER_ICON_SIZE as f32 + 28.0;
    }
    let (px, name) = fit(&BOLD, name, SIZE.0 as f32 - MARGIN - left);
    let line = Line::new(&BOLD, px, 0.0, &name);
    line.draw(&mut card, left, line.baseline_centered_on(center), |_| TEXT);
    encode(&card)
}

/// The site's card, for pages without a picture of their own: the given picture (the home page's header) with
/// the wordmark and the site's description over a shade from the left. Made once with the API's `site-card`
/// command and committed to the web app.
pub fn site_card(picture: &[u8]) -> Result<Vec<u8>, String> {
    let mut card = background(picture)?;
    shade_across(&mut card, &[(0.0, 0.82), (0.45, 0.35), (0.70, 0.0)]);
    let description = Line::new(&REGULAR, 30.0, 0.0, SITE_DESCRIPTION);
    let description_baseline = SIZE.1 as f32 - 72.0;
    description.draw(&mut card, MARGIN, description_baseline, |_| TEXT_SOFT);
    wordmark(&mut card, 72.0, MARGIN, description_baseline - 160.0);
    encode(&card)
}

/// "SOURCEJUMP" in the header's style: bold capitals spaced a tenth of their size apart, "JUMP" in the accent.
/// `top` is where the capitals start.
fn wordmark(card: &mut RgbImage, px: f32, left: f32, top: f32) {
    let line = Line::new(&BOLD, px, px * 0.1, "SOURCEJUMP");
    let baseline = top + line.cap_height();
    line.draw(
        card,
        left,
        baseline,
        |index| if index < 6 { TEXT } else { ACCENT },
    );
}

/// The largest size from 84 px down to 52 px at which the name fits in `width`; a name too long even then is
/// cut short with an ellipsis.
fn fit(font: &FontRef<'static>, name: &str, width: f32) -> (f32, String) {
    const LARGEST: f32 = 84.0;
    const SMALLEST: f32 = 52.0;
    let mut px = LARGEST;
    while px > SMALLEST && Line::new(font, px, 0.0, name).width > width {
        px -= 2.0;
    }
    if Line::new(font, px, 0.0, name).width <= width {
        return (px, name.to_owned());
    }
    let mut kept: Vec<char> = name.chars().collect();
    while !kept.is_empty() {
        kept.pop();
        let shortened: String = kept.iter().chain(['…'].iter()).collect();
        if Line::new(font, px, 0.0, &shortened).width <= width {
            return (px, shortened);
        }
    }
    (px, "…".to_owned())
}

/// One line of text, laid out with the font's kerning and extra `spacing` between letters.
struct Line<'a> {
    font: &'a FontRef<'static>,
    px: f32,
    glyphs: Vec<Glyph>,
    width: f32,
}

impl<'a> Line<'a> {
    fn new(font: &'a FontRef<'static>, px: f32, spacing: f32, text: &str) -> Self {
        let scaled = font.as_scaled(PxScale::from(px));
        let mut glyphs = Vec::new();
        let mut x = 0.0;
        let mut previous = None;
        for character in text.chars() {
            let id = font.glyph_id(character);
            if let Some(previous) = previous {
                x += scaled.kern(previous, id) + spacing;
            }
            glyphs.push(id.with_scale_and_position(px, point(x, 0.0)));
            x += scaled.h_advance(id);
            previous = Some(id);
        }
        Self {
            font,
            px,
            glyphs,
            width: x,
        }
    }

    /// How far capitals reach above the baseline.
    fn cap_height(&self) -> f32 {
        let scaled = self.font.as_scaled(PxScale::from(self.px));
        let h = self.font.glyph_id('H');
        scaled
            .outline_glyph(h.with_scale(self.px))
            .map_or(scaled.ascent(), |outline| -outline.px_bounds().min.y)
    }

    /// The baseline that centres the line's capitals and lowercase on `center`: halfway up the x-height reads as
    /// the middle of a lowercase map name better than the middle of the font's whole ascent and descent.
    fn baseline_centered_on(&self, center: f32) -> f32 {
        let scaled = self.font.as_scaled(PxScale::from(self.px));
        let x_height = scaled
            .outline_glyph(self.font.glyph_id('x').with_scale(self.px))
            .map_or(self.cap_height() * 0.7, |outline| {
                -outline.px_bounds().min.y
            });
        center + (self.cap_height() + x_height) / 4.0
    }

    /// Draws the line with its left edge at `left` and its baseline at `baseline`; `color` picks each letter's
    /// colour by its index.
    fn draw(
        &self,
        card: &mut RgbImage,
        left: f32,
        baseline: f32,
        color: impl Fn(usize) -> [u8; 3],
    ) {
        for (index, glyph) in self.glyphs.iter().enumerate() {
            let mut glyph = glyph.clone();
            glyph.position = point(glyph.position.x + left, glyph.position.y + baseline);
            let Some(outline) = self.font.outline_glyph(glyph) else {
                continue; // a space
            };
            let bounds = outline.px_bounds();
            let rgb = color(index);
            outline.draw(|x, y, coverage| {
                let x = bounds.min.x as i64 + i64::from(x);
                let y = bounds.min.y as i64 + i64::from(y);
                blend(card, x, y, rgb, coverage.min(1.0));
            });
        }
    }
}

/// The picture scaled and cropped around its centre to fill the card.
fn background(picture: &[u8]) -> Result<RgbImage, String> {
    let decoded = ImageReader::new(Cursor::new(picture))
        .with_guessed_format()
        .map_err(|_| "the picture couldn't be read".to_owned())?
        .decode()
        .map_err(|error| format!("the picture couldn't be decoded: {error}"))?;
    Ok(decoded
        .resize_to_fill(SIZE.0, SIZE.1, FilterType::Lanczos3)
        .to_rgb8())
}

/// Lays the background colour over the card from top to bottom, as opaque as `stops` say at each height
/// (position 0–1, opacity 0–1), in straight lines between them.
fn shade_down(card: &mut RgbImage, stops: &[(f32, f32)]) {
    let height = card.height();
    for y in 0..height {
        let opacity = along(stops, y as f32 / (height - 1) as f32);
        for x in 0..card.width() {
            blend(card, i64::from(x), i64::from(y), BACKGROUND, opacity);
        }
    }
}

/// `shade_down`, from left to right.
fn shade_across(card: &mut RgbImage, stops: &[(f32, f32)]) {
    let width = card.width();
    for x in 0..width {
        let opacity = along(stops, x as f32 / (width - 1) as f32);
        for y in 0..card.height() {
            blend(card, i64::from(x), i64::from(y), BACKGROUND, opacity);
        }
    }
}

/// The value at `position` on a line through `stops`; flat beyond the first and last.
fn along(stops: &[(f32, f32)], position: f32) -> f32 {
    let mut value = stops.first().map_or(0.0, |stop| stop.1);
    for pair in stops.windows(2) {
        let ((from, a), (to, b)) = (pair[0], pair[1]);
        if position >= from {
            value = if position >= to {
                b
            } else {
                a + (b - a) * (position - from) / (to - from)
            };
        }
    }
    value
}

/// Lays `color` over one pixel at `opacity`; pixels off the card are skipped.
fn blend(card: &mut RgbImage, x: i64, y: i64, color: [u8; 3], opacity: f32) {
    let (Ok(x), Ok(y)) = (u32::try_from(x), u32::try_from(y)) else {
        return;
    };
    if x >= card.width() || y >= card.height() || opacity <= 0.0 {
        return;
    }
    let pixel = card.get_pixel_mut(x, y);
    for (channel, target) in pixel.0.iter_mut().zip(color) {
        let mixed = f32::from(*channel) + (f32::from(target) - f32::from(*channel)) * opacity;
        *channel = mixed.round().clamp(0.0, 255.0) as u8;
    }
}

/// Lays a picture with transparency over the card, its top left corner at (`left`, `top`).
fn overlay(card: &mut RgbImage, picture: &RgbaImage, left: i64, top: i64) {
    for (x, y, pixel) in picture.enumerate_pixels() {
        let [r, g, b, a] = pixel.0;
        blend(
            card,
            left + i64::from(x),
            top + i64::from(y),
            [r, g, b],
            f32::from(a) / 255.0,
        );
    }
}

fn encode(card: &RgbImage) -> Result<Vec<u8>, String> {
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, QUALITY)
        .encode_image(card)
        .map_err(|error| format!("the card couldn't be encoded: {error}"))?;
    Ok(jpeg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maps::image::tests::png;

    fn decode(jpeg: &[u8]) -> RgbImage {
        image::load_from_memory(jpeg).unwrap().to_rgb8()
    }

    #[test]
    fn a_map_card_is_a_1200_by_630_jpeg_from_any_cover() {
        for (width, height) in [(1920, 1080), (2560, 1080), (800, 800)] {
            let card = map_card(&png(width, height), "bhop_badges", Some(3)).unwrap();
            assert_eq!(&card[..2], [0xff, 0xd8], "JPEG");
            assert_eq!(decode(&card).dimensions(), SIZE);
        }
        assert!(map_card(b"not a picture", "bhop_badges", None).is_err());
    }

    #[test]
    fn long_names_shrink_and_then_are_cut_short() {
        let room = SIZE.0 as f32 - 2.0 * MARGIN;
        assert_eq!(
            fit(&BOLD, "bhop_badges", room),
            (84.0, "bhop_badges".to_owned())
        );
        let (px, name) = fit(&BOLD, "bhop_a_rather_long_map_name_v2", room);
        assert!(
            px < 84.0 && name == "bhop_a_rather_long_map_name_v2",
            "{px} {name}"
        );
        let (px, name) = fit(&BOLD, &"bhop_".repeat(12), room);
        assert_eq!(px, 52.0);
        assert!(name.ends_with('…'), "{name}");
        assert!(Line::new(&BOLD, px, 0.0, &name).width <= room);
    }

    #[test]
    fn the_shade_follows_its_stops() {
        let stops = [(0.0, 0.8), (0.5, 0.0), (1.0, 1.0)];
        assert!((along(&stops, 0.0) - 0.8).abs() < 1e-6);
        assert!((along(&stops, 0.25) - 0.4).abs() < 1e-6);
        assert!(along(&stops, 0.5).abs() < 1e-6);
        assert!((along(&stops, 1.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn the_site_card_is_1200_by_630() {
        let card = site_card(&png(1376, 768)).unwrap();
        assert_eq!(decode(&card).dimensions(), SIZE);
    }
}
