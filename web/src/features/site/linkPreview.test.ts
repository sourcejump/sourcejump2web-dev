// Which picture a link preview carries.
import { describe, expect, it } from "vitest";
import { card, linkPreview, SITE_CARD } from "./linkPreview";

describe("linkPreview", () => {
  it("shows a drawn card large", () => {
    const preview = linkPreview({
      title: "bhop_badges",
      description: "Tier 3.",
      picture: card(
        "https://files.example/maps/bhop_badges/card-0123456789ab.jpg",
      ),
    });
    expect(preview.openGraph?.images).toEqual([
      {
        url: "https://files.example/maps/bhop_badges/card-0123456789ab.jpg",
        width: 1200,
        height: 630,
      },
    ]);
    expect(preview.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("falls back to the site's card without a picture", () => {
    const preview = linkPreview({ title: "nova", description: "No runs yet." });
    expect(preview.openGraph?.images).toEqual([
      { url: SITE_CARD.url, width: 1200, height: 630 },
    ]);
  });

  it("shows an avatar small", () => {
    const preview = linkPreview({
      title: "nova",
      description: "No runs yet.",
      picture: { url: "https://avatars.example/nova.jpg", wide: false },
    });
    expect(preview.twitter).toMatchObject({ card: "summary" });
  });
});
