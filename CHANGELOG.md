# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each version is a git tag (`v0.1.0`), and `VERSION`
matches it.

## [Unreleased]

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
