// Measures the line metrics ImageMarkupKit's text layout gets on iOS (UIKit, TextKit), as fractions of the font
// size, for src/text/metrics.ts: line height (ascender − descender + leading, as boundingRect measures it with
// [.usesLineFragmentOrigin, .usesFontLeading]) and where each line's baseline sits (TextKit line fragments; the
// leading goes below the line). macOS reports different metrics for the system font, so run this on iOS:
//
//   xcrun --sdk iphonesimulator swiftc -target arm64-apple-ios17.0-simulator -o /tmp/text-metrics tools/swift/text-metrics.swift
//   xcrun simctl spawn booted /tmp/text-metrics
import UIKit

func font(_ family: String, _ size: CGFloat, _ bold: Bool) -> UIFont {
    let weight: UIFont.Weight = bold ? .bold : .regular
    func design(_ design: UIFontDescriptor.SystemDesign) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        guard let descriptor = base.fontDescriptor.withDesign(design) else { return base }
        return UIFont(descriptor: descriptor, size: size)
    }
    switch family {
    case "system": return .systemFont(ofSize: size, weight: weight)
    case "rounded": return design(.rounded)
    case "serif": return design(.serif)
    case "monospaced": return design(.monospaced)
    case "hiraginoSans": return UIFont(name: bold ? "HiraginoSans-W6" : "HiraginoSans-W3", size: size)!
    default: return UIFont(name: bold ? "HiraMinProN-W6" : "HiraMinProN-W3", size: size)!
    }
}

for family in ["system", "rounded", "serif", "monospaced", "hiraginoSans", "hiraginoMincho"] {
    for bold in [false, true] {
        let f = font(family, 100, bold)
        let storage = NSTextStorage(string: "Ag\nAg", attributes: [.font: f])
        let manager = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: 10_000, height: 10_000))
        container.lineFragmentPadding = 0
        manager.addTextContainer(container)
        storage.addLayoutManager(manager)
        manager.ensureLayout(for: container)
        let first = manager.lineFragmentRect(forGlyphAt: 0, effectiveRange: nil)
        let second = manager.lineFragmentRect(forGlyphAt: 3, effectiveRange: nil)
        let measured = NSAttributedString(string: "Ag", attributes: [.font: f])
            .boundingRect(with: CGSize(width: 10_000, height: 10_000), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        print(String(format: "%@ %@: lineHeight %.7f (fragment %.7f) ascent %.7f",
                     family, bold ? "bold" : "regular", measured.height / 100, (second.minY - first.minY) / 100,
                     (first.minY + manager.location(forGlyphAt: 0).y) / 100))
    }
}
