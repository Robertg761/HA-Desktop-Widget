# Emoji names

The names and keywords of every emoji, in each language the app speaks, which the custom icon
picker in Settings searches (`src/emoji-names.js`). They come from the emoji annotations of the
Unicode Common Locale Data Repository (CLDR), release 48.2.0, and are under the Unicode License v3
in `LICENSE`.

Each file maps an emoji, without the variation selector U+FE0F, to its name followed by its
keywords, joined with `|`. Skin-tone variants have no entry: the app joins the entry of the emoji
without its tone and the entries of its tones, with the `toneName` and `toneJoin` of that language.

The files are generated. To bring them up to a newer CLDR, or to the emoji list of a newer
`regenerate-unicode-properties`, unpack the two CLDR packages somewhere outside the repository and
run the script:

```bash
npm pack cldr-annotations-full@48.2.0 cldr-annotations-derived-full@48.2.0
mkdir full derived
tar xzf cldr-annotations-full-48.2.0.tgz -C full
tar xzf cldr-annotations-derived-full-48.2.0.tgz -C derived
node scripts/build-emoji-names.cjs full/package derived/package
```

Then update the release named above and in `THIRD-PARTY-NOTICES.txt`. `tests/unit/emoji-names.test.js`
checks that every emoji the picker lists has a name in every language.
