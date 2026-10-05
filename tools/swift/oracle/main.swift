// Codec oracle: ImageMarkupKit's own model code (UIKit-free files only), used to check that the TypeScript codec
// reads and writes exactly what the Swift package does.
//
//   oracle document <file.json>             decode with MarkupDocument.decode(from:), print jsonData()
//   oracle features <file.json>             decode MarkupFeatures(jsonData:), print jsonData() or the error
//   oracle features-template [feature...]   print MarkupFeatures.all with the given features disabled
//   oracle features-template-groups [group...] print MarkupFeatures.all with the given groups disabled
import Foundation

func output(_ data: Data) {
    FileHandle.standardOutput.write(data)
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard let command = arguments.first else {
    FileHandle.standardError.write(Data("usage: oracle document|features|features-template ...\n".utf8))
    exit(2)
}

do {
    switch command {
    case "document":
        let data = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
        output(try MarkupDocument.decode(from: data).jsonData())
    case "features":
        let data = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
        do {
            output(try MarkupFeatures(jsonData: data).jsonData())
        } catch let error as MarkupFeaturesError {
            output(Data("error: \(error)".utf8))
        }
    case "features-template":
        var features = MarkupFeatures.all
        for name in arguments.dropFirst() {
            guard let feature = MarkupFeature(rawValue: name) else { throw CocoaError(.coderInvalidValue) }
            features.setEnabled(false, feature)
        }
        output(try features.jsonData())
    case "features-template-groups":
        var features = MarkupFeatures.all
        for name in arguments.dropFirst() {
            guard let group = MarkupFeatureGroup(rawValue: name) else { throw CocoaError(.coderInvalidValue) }
            features.setEnabled(false, group: group)
        }
        output(try features.jsonData())
    default:
        throw CocoaError(.featureUnsupported)
    }
} catch {
    output(Data("error: \(error)".utf8))
    exit(1)
}
