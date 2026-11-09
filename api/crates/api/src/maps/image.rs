//! Turning an uploaded picture into a map's image: whatever comes in (PNG, JPEG or WebP, any size from
//! 1920×1080 up), the same two files come out, so every map looks alike and loads quickly.
//!
//! The picture is cropped to 16:9 around its centre (the game's shape), resized to the two sizes with a
//! high-quality filter, and encoded as WebP at one fixed quality. Re-encoding from pixels also drops every
//! piece of metadata the upload carried, such as where a photo was taken.

use std::{fmt::Write, io::Cursor};

use image::{ImageFormat, ImageReader, Limits, RgbImage, imageops::FilterType};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use utoipa::ToSchema;

use crate::storage::Storage;

pub mod folder;

/// The largest upload accepted, in bytes. A 4K PNG screenshot is well under this.
pub const MAX_UPLOAD_BYTES: usize = 15 * 1024 * 1024;
/// The map page's banner at its widest, sharp on high-density screens.
pub const LARGE: (u32, u32) = (1920, 1080);
/// Map tiles, run tiles and phones; sharp at the sizes the site shows them.
pub const SMALL: (u32, u32) = (480, 270);
/// WebP quality, 0–100. Around 80 keeps game screenshots clean at a fraction of the size.
const QUALITY: f32 = 80.0;
/// Bounds what a decoder may allocate, so a crafted file can't exhaust memory.
const MAX_SIDE: u32 = 8192;
const MAX_ALLOC: u64 = 512 * 1024 * 1024;

/// One of a map's pictures as clients show it.
#[derive(Debug, Clone, Serialize, serde::Deserialize, ToSchema)]
pub struct MapImage {
    pub id: i64,
    /// 1920×1080 WebP.
    pub url: String,
    /// 480×270 WebP, for lists.
    pub thumbnail_url: String,
    /// Which horizontal strip a short banner shows: 0 the top, 100 the bottom.
    pub focus: i16,
}

impl MapImage {
    pub fn new(storage: &Storage, id: i64, key: &str, focus: i16) -> Self {
        Self {
            id,
            url: storage.public_url(&file_key(key, LARGE)),
            thumbnail_url: storage.public_url(&file_key(key, SMALL)),
            focus,
        }
    }

    /// A map's cover from a LEFT JOIN on `map_images` at position 0; None when the map has no pictures.
    pub fn cover(
        storage: &Storage,
        id: Option<i64>,
        key: Option<String>,
        focus: Option<i16>,
    ) -> Option<Self> {
        Some(Self::new(storage, id?, &key?, focus.unwrap_or(50)))
    }
}

/// The most pictures a map holds; `map_images.position` caps it in the database too.
pub const MAX_IMAGES: i64 = 10;

/// The map's pictures in order, the cover first.
pub async fn images_of(
    db: &PgPool,
    storage: &Storage,
    map_id: i64,
) -> Result<Vec<MapImage>, sqlx::Error> {
    let rows = sqlx::query!(
        "SELECT id, key, focus FROM map_images WHERE map_id = $1 ORDER BY position",
        map_id
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| MapImage::new(storage, row.id, &row.key, row.focus))
        .collect())
}

/// The object key of one size of an image.
pub fn file_key(image_key: &str, (width, _): (u32, u32)) -> String {
    format!("{image_key}-{width}.webp")
}

/// An image ready to store.
#[derive(Debug)]
pub struct Processed {
    pub large: Vec<u8>,
    pub small: Vec<u8>,
    /// Names the image by its content: the first 12 hex digits of the large file's SHA-256.
    pub hash: String,
}

/// Reads, crops, resizes and encodes an upload. The error is a sentence for the staff member.
pub fn process(upload: &[u8]) -> Result<Processed, String> {
    if upload.len() > MAX_UPLOAD_BYTES {
        return Err("the image is over 15 MB".to_owned());
    }
    process_file(upload)
}

/// `process` without the upload size cap, for files a staff member runs through the command line on their
/// own machine; the decoder's limits still bound what a file can cost.
pub fn process_file(upload: &[u8]) -> Result<Processed, String> {
    let mut reader = ImageReader::new(Cursor::new(upload))
        .with_guessed_format()
        .map_err(|_| "the image couldn't be read".to_owned())?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP)
    ) {
        return Err("upload a PNG, JPEG or WebP image".to_owned());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_ALLOC);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| {
            format!(
                "the image couldn't be read; it may be damaged or over {MAX_SIDE} pixels a side"
            )
        })?
        .to_rgb8();

    check_size(decoded.width(), decoded.height())?;
    let cropped = crop_to_16_9(&decoded);
    let large = encode(&cropped, LARGE);
    let small = encode(&cropped, SMALL);
    let mut hash = String::with_capacity(12);
    for byte in &Sha256::digest(&large)[..6] {
        write!(hash, "{byte:02x}").expect("writing to a String can't fail");
    }
    Ok(Processed { large, small, hash })
}

/// Whether a picture of this size still fills the large size once cropped to 16:9; never scaled up.
pub fn check_size(width: u32, height: u32) -> Result<(), String> {
    let (crop_width, crop_height) = size_16_9(width, height);
    if crop_width < LARGE.0 {
        return Err(format!(
            "the image is {crop_width}×{crop_height} once cropped to 16:9; it needs at least {}×{}",
            LARGE.0, LARGE.1
        ));
    }
    Ok(())
}

/// The size of the largest 16:9 area inside a picture.
fn size_16_9(width: u32, height: u32) -> (u32, u32) {
    if u64::from(width) * 9 > u64::from(height) * 16 {
        (height * 16 / 9, height)
    } else {
        (width, width * 9 / 16)
    }
}

/// The largest 16:9 area around the centre.
fn crop_to_16_9(image: &RgbImage) -> RgbImage {
    let (width, height) = image.dimensions();
    let (crop_width, crop_height) = size_16_9(width, height);
    image::imageops::crop_imm(
        image,
        (width - crop_width) / 2,
        (height - crop_height) / 2,
        crop_width,
        crop_height,
    )
    .to_image()
}

fn encode(image: &RgbImage, (width, height): (u32, u32)) -> Vec<u8> {
    let resized = image::imageops::resize(image, width, height, FilterType::Lanczos3);
    webp::Encoder::from_rgb(&resized, width, height)
        .encode(QUALITY)
        .to_vec()
}

#[cfg(test)]
pub mod tests {
    use image::{DynamicImage, Rgb};

    use super::*;

    /// A PNG of the given size with a gradient, so the encoder has something to compress.
    pub fn png(width: u32, height: u32) -> Vec<u8> {
        let image = RgbImage::from_fn(width, height, |x, y| {
            let byte = |value: u32| u8::try_from(value % 256).unwrap();
            Rgb([byte(x), byte(y), byte(x + y)])
        });
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn size(webp: &[u8]) -> (u32, u32) {
        let image = image::load_from_memory_with_format(webp, ImageFormat::WebP).unwrap();
        (image.width(), image.height())
    }

    #[test]
    fn any_large_enough_picture_becomes_the_two_sizes() {
        // 16:10 and 21:9 both crop to 16:9.
        for (width, height) in [(1920, 1200), (2560, 1080), (3840, 2160)] {
            let processed = process(&png(width, height)).unwrap();
            assert_eq!(size(&processed.large), LARGE);
            assert_eq!(size(&processed.small), SMALL);
            assert_eq!(processed.hash.len(), 12);
        }
    }

    #[test]
    fn small_or_unreadable_uploads_are_refused() {
        let narrow = process(&png(1600, 1200)).unwrap_err();
        assert!(narrow.contains("1600×900"), "{narrow}");
        assert!(process(b"GIF89a not really").is_err());
        assert!(process(&vec![0; MAX_UPLOAD_BYTES + 1]).is_err());
    }

    #[test]
    fn the_same_picture_gets_the_same_name() {
        let upload = png(1920, 1080);
        assert_eq!(
            process(&upload).unwrap().hash,
            process(&upload).unwrap().hash
        );
    }
}
