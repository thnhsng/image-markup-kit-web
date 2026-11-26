# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each version is a git tag (`v0.1.0`), and `VERSION`
matches it.

## [Unreleased]

## [0.2.0] - 2026-11-26

### Added

- Speech bubble tails can be pointed anywhere: a selected bubble has a yellow handle on the tip of its tail, which
  drags anywhere (even past the bubble), and one on the end of its base, which makes the tail wider or narrower. The
  first drag turns the bubble's box into just its body, without moving anything; one undo step puts it back.
  `ShapeContent.tail` (`BubbleTail`: `tip`, `width`) holds the tail, written to `document.json` only once a tail
  has been dragged, as ImageMarkupKit 0.4.0 (Swift) writes it. Clicks and the eraser reach the tail wherever it is,
  and exports and shadows include it.
- The debug driver's `dragBubbleTail` gesture, and the `adjustTail` undo action name ("Adjust Tail").

### Changed

- `ShapeContent` has a `tail` field, `null` for every shape but an adjusted speech bubble: code that builds shape
  contents by hand adds `tail: null` (`createShapeItem` sets it, and takes a `tail` option).

## [0.1.1] - 2026-11-26

### Fixed

- A board no longer exports with a white frame around what is drawn: a photo opened as a board and marked up inside
  its edges exports as just the photo, edge to edge. Marks past a photo's edge widen the image just to their tips:
  no longer by an arrowhead's length around a whole arrow.
- No sliver of background along a board photo's right or bottom edge: the export is no longer rounded out to whole
  canvas units (photos on a board are rarely a whole number of units wide).
- The sharp corners of mitered borders (triangles, stars, diamonds, pentagons, rotated rectangles and bordered photos)
  are no longer cut off at the edge of a board export.

### Changed

- `boardPadding` is 0 by default (it was 24). Pass `boardPadding: 24` for the former margin.

## [0.1.0] - 2026-10-05

The first release: the web counterpart of ImageMarkupKit 0.2.0 for Swift.

### Added

- `MarkupEditor` for React 18 and 19: annotate one photo (`image`), lay out a board (`images`) or edit a document
  again (`document` and `assets`); `onDone` (a returned Promise keeps the editor busy), `onCancel` with the discard
  dialog, `onError`, `onStateChange` and a `ref` handle with scripted gestures.
- Tools: select, pen, highlighter, eleven shapes, arrows and lines, polylines, curves, text, notes and the object
  eraser; bindings of line ends to items; marks attached to board photos; undo and redo (100 steps).
- Toolbar in one row on wide editors and two rows on narrow ones; Shape Style, Border, Fill and Text Style panels as
  popovers or sheets; selection action bar; keyboard shortcuts; pinch, wheel and trackpad zoom; input methods.
- `MarkupFeatures` with the same JSON as the Swift package; English and Japanese strings, replaceable; CSS-variable
  themes; a stylesheet nonce for strict Content Security Policies.
- `document.json` schema 1, written and read byte for byte like the Swift package (`serializeDocument`,
  `parseDocument`), and editable packages (`createMarkupPackage`, `readMarkupPackage`).
- `renderMarkup` and `planExport` for exports without the editor: JPEG or PNG, a 16 MP default budget for iOS Safari,
  and `maxBytes` with fallback qualities.
- Photo import with EXIF orientation, HEIC kept byte for byte, and on-screen copies sized for the screen.

[Unreleased]: https://github.com/thnhsng/image-markup-kit-web/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/thnhsng/image-markup-kit-web/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/thnhsng/image-markup-kit-web/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/thnhsng/image-markup-kit-web/releases/tag/v0.1.0
