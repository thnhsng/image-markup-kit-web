// Stand-ins for the UIKit-dependent pieces the model and geometry sources refer to. The oracle never measures text,
// reads image files or exports pixels, so these only need to compile.
import CoreGraphics
import Foundation

public struct ImageMetadata: Equatable, Sendable {
    public var pixelSize: CGSize
    public var orientation: UInt32
    public var typeIdentifier: String?
}

enum ImagePipeline {
    static func metadata(at url: URL) -> ImageMetadata? { nil }
}

enum TextLayout {
    static func measuredSize(for content: TextContent) -> CGSize { content.box.frame.size }
    static func fitted(_ content: TextContent) -> TextContent { content }
}

/// The fields of MarkupExportOptions that ExportPlanner reads (the real type lives in a UIKit file).
public struct MarkupExportOptions: Equatable, Sendable {
    public var maxPixelDimension: CGFloat = 8192
    public var maxPixelCount: CGFloat = 40_000_000
    public var boardPadding: CGFloat = 24
    public var minimumBoardScale: CGFloat = 2
    public static let `default` = MarkupExportOptions()
}
